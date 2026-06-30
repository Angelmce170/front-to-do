import {openDB} from 'idb';

export type LocalTask = Record<string, unknown> & {_id: string};
export type OutboxTaskData = {
    title?: string;
    description?: string | null;
    status?: string;
    reminderAt?: string | null;
} & Record<string, unknown>;

export type OutboxOp = 
    | {id: string, op:"create"; clienteId: string; data: OutboxTaskData; ts:number}
    | {id: string, op:"update"; serverId?: string; clienteId?: string; data: OutboxTaskData; ts: number}
    | {id: string, op:"delete"; serverId?: string; clienteId?: string; ts: number};

type DBSchema ={
    tasks:{key: string, value: LocalTask};
    outbox:{key:string, value: OutboxOp};
    meta:{key:string, value:{key: string; serverId?: string}};
};

let dbp: ReturnType<typeof openDB<DBSchema>>;

export function db(){
    if(!dbp){
        dbp = openDB<DBSchema>('todo-pwa', 1,{
            upgrade(d){
                d.createObjectStore("tasks", {keyPath: "_id"});
                d.createObjectStore("outbox", {keyPath: "id"});
                d.createObjectStore("meta", {keyPath: "key"});
            },
        });
    }
    return dbp;
}
export async function cacheTasks(list: LocalTask[]){
    const tx = (await db()).transaction("tasks", "readwrite");
    const s = tx.objectStore("tasks");
    await s.clear();
    for (const t of list) await s.put(t);
    await tx.done;
}

export async function putTaskLocal(task: LocalTask){await (await db()).put("tasks", task);}
export async function getAllTasksLocal(){return (await (await db()).getAll("tasks")) || [];}
export async function removeTaskLocal(id: string){await (await db()).delete("tasks", id);}

/** promociona una tarea local a la version del servidor */
export async function promoteLocalToServer(clienteId: string, serverId: string){
    const d = await db();
    const t = await d.get("tasks", clienteId);
    if(t){
        await d.delete("tasks", clienteId);
        t._id = serverId;
        t.pending = false;
        await d.put("tasks", t);
    }
}

    export async function queue(op: OutboxOp) {await (await db()).put("outbox", op);}
    export async function getOutbox() {return (await (await db()).getAll("outbox")) || [];}
    export async function clearOutbox(){
        const tx = (await db()).transaction("outbox", "readwrite");
        await tx.objectStore("outbox").clear();
        await tx.done;
    }

    //MAPEO CLIENTEID -> SERVERID
    export async function setMapping(clienteId: string, serverId: string) {
        await (await db()).put("meta", {key:clienteId, serverId});}
    export async function getMapping(clienteId: string) {
        return (await (await db()).get("meta", clienteId))?.serverId as string | undefined; 
    }
