import {api} from '../api';

import {
    getOutbox,
    clearOutbox,
    setMapping,
    getMapping,
    removeTaskLocal,
    promoteLocalToServer,
} from './db';

let syncing = false; // Evita que se ejecute más de una sincronización a la vez
let lastSyncAt = 0; // Marca de tiempo de la última sincronización exitosa. Se usa para evitar sincronizaciones muy frecuentes.

type SyncTask = {
    clienteId: string;
    title?: string;
    description?: string;
    status?: string;
    reminderAt?: string | null;
};

const optionalText = (value: unknown) =>
    typeof value === "string" ? value : undefined;
const textOrEmpty = (value: unknown) =>
    typeof value === "string" ? value : "";
const reminderValue = (value: unknown) =>
    typeof value === "string" || value === null ? value : undefined;

export async function syncNow() {
    if (!navigator.onLine) return; // No tiene sentido intentar sincronizar si no hay conexión

    const now = Date.now();
    if (now - lastSyncAt < 1500) return; // Evita sincronizaciones muy frecuentes (menos de 5 segundos entre ellas)
    lastSyncAt = now;

    if (syncing) return; // Ya hay una sincronización en curso
    syncing = true;

    try{
        const ops = (await getOutbox()).sort((a, b) => a.ts - b.ts); // Ordena las operaciones por su marca de tiempo para procesarlas en orden
        if(ops.length === 0) return; // No hay operaciones pendientes, no es necesario sincronizar

        for(const op of ops) {
            if(op.op !== "profile") continue;

            try {
                const {data} = await api.put("/auth/me", op.data);
                if(data?.user) localStorage.setItem("user", JSON.stringify(data.user));
            } catch {
                // Si falla, se conserva en outbox y se vuelve a intentar al reconectar.
                return;
            }
        }

        const toSync: SyncTask[] = [];
        for(const op of ops) {
            if(op.op === "create") {
                toSync.push({
                    clienteId: op.clienteId,
                    title: optionalText(op.data.title),
                    description: textOrEmpty(op.data.description),
                    status: optionalText(op.data.status) ?? "Pendiente",
                    reminderAt: reminderValue(op.data.reminderAt) ?? null,
                });
            }else if (op.op === "update") {
                // Para las actualizaciones, necesitamos el serverId para poder actualizar la tarea correcta en el servidor. Si no lo tenemos, es que la tarea aún no se ha creado en el servidor, así que la tratamos como una creación.
                const cid = op.clienteId;
                if(cid){
                    toSync.push({
                        clienteId: cid,
                        title: optionalText(op.data.title),
                        description: optionalText(op.data.description),
                        status: optionalText(op.data.status),
                        reminderAt: reminderValue(op.data.reminderAt),
                });
            } else if (op.serverId) {
                try {
                    await api.put(`/tasks/${op.serverId}`, op.data);
                } catch {
                    // Si la actualización falla, no hacemos nada. La operación seguirá en la outbox y se intentará de nuevo en la próxima sincronización.

                }
            }
        }
    }
    
    if(toSync.length) {
        try{
            const {data} = await api.post("/tasks/bulksync", {tasks: toSync});
            for (const map of data?.mapping || []) {
                await setMapping(map.clienteId, map.serverId);
                await promoteLocalToServer(map.clienteId, map.serverId);
            }
        }catch {
            // Si la sincronización falla, no hacemos nada. Las operaciones seguirán en la outbox y se intentará de nuevo en la próxima sincronización.
            return;
        }
    }

    // proceso deletes por separado porque no necesitan clienteId, solo serverId
    for(const op of ops) {
        if(op.op !== "delete") continue;
        const serverId = op.serverId ?? (op.clienteId ? await getMapping(op.clienteId) : undefined);
        if(!serverId) continue; // Si no tenemos un serverId, no podemos eliminar la tarea en el servidor, así que la dejamos para la próxima sincronización
        try{
            await api.delete(`/tasks/${serverId}`);
            await removeTaskLocal(op.clienteId || serverId); // Eliminamos la tarea localmente usando el clienteId si lo tenemos, o el serverId si no
        }catch {
            // Si la eliminación falla, no hacemos nada. La operación seguirá en la outbox y se intentará de nuevo en la próxima sincronización.
        }
    }
    //si todo lo anterior se ha procesado sin errores, podemos limpiar la outbox
    await clearOutbox();
    } finally {
        syncing = false;
    }
}

//suscripcion dispara sync al reconectarse
export function setupOnlineSync() {
    const handler = () => {
        void syncNow();
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
}
