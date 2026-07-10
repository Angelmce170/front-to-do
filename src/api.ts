import axios from "axios";

export const API_URL =
    import.meta.env.VITE_API_URL ||
    (import.meta.env.DEV
        ? "http://localhost:4000/api"
        : "https://back-to-do-phh5.vercel.app/api");

export const api = axios.create({
    baseURL: API_URL,
    timeout: 12000,
});

export function setAuth(token: string | null) {
    if (token) {
        api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    } else {
        delete api.defaults.headers.common["Authorization"];
    }
}

// Cargar token guardado al iniciar la app
setAuth(localStorage.getItem("token"));

// Si el token expira o es inválido, cerrar sesión
api.interceptors.response.use(
    (response) => response,
    (err) => {
        if (err.response?.status === 401) {
            localStorage.removeItem("token");
            setAuth(null);
            window.location.href = "/login";
        }

        return Promise.reject(err);
    }
);
