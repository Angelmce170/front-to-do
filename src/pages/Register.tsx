import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";


export default function Register() {
    const nav = useNavigate();
    const [name , setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(""); setLoading(true);
        try{
            const {data} = await api.post("/auth/register", {name, email, password});
            localStorage.setItem("token", data.token);
            if (data.user) localStorage.setItem("user", JSON.stringify(data.user));
            setAuth(data.token);
            nav("/dashboard");
        }catch (err: unknown) {
            const requestError = err as { response?: { data?: { message?: string } } };
            setError(requestError.response?.data?.message || "Error al registrarte papi intentalo de nuevo");
        }finally {
            setLoading(false);
        }
    }

    return (
        <main className="login-page">
            <section className="login-shell">
                <div className="login-brand-panel">
                    <div className="login-brand">
                        <span className="login-mark" aria-hidden="true">✓</span>
                        <div>
                            <p className="login-eyebrow">TO-DO PWA</p>
                            <strong>Mis tareas</strong>
                        </div>
                    </div>

                    <div className="login-welcome">
                        <p className="login-eyebrow">NUEVA CUENTA</p>
                        <h1>Empieza simple.</h1>
                        <p>Crea tu cuenta y mantén tus pendientes listos para trabajar incluso sin conexión.</p>
                    </div>

                    <div className="login-status">
                        <span />
                        Sincronización automática al volver a internet
                    </div>
                </div>

                <div className="login-form-panel">
                    <div className="login-heading">
                        <p className="login-eyebrow">REGISTRO</p>
                        <h2>Crear cuenta</h2>
                        <p>Guarda tus tareas y continúa desde cualquier sesión.</p>
                    </div>

                    <form className="login-form" onSubmit={onSubmit}>
                        <label htmlFor="name">Nombre completo</label>
                        <input
                            id="name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Tu nombre"
                            autoComplete="name"
                            required
                        />

                        <label htmlFor="email">Correo electrónico</label>
                        <input
                            id="email"
                            type="email"
                            placeholder="nombre@correo.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoComplete="email"
                            required
                        />

                        <label htmlFor="password">Contraseña</label>
                        <input
                            id="password"
                            type="password"
                            placeholder="Crea una contraseña"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="new-password"
                            required
                        />

                        {error && <div className="login-alert">{error}</div>}

                        <button type="submit" className="login-submit" disabled={loading}>
                            {loading ? "Creando cuenta..." : "Crear cuenta"}
                            {!loading && <span aria-hidden="true">→</span>}
                        </button>
                    </form>

                    <div className="login-footer">
                        <span>¿Ya tienes una cuenta?</span>
                        <Link to="/">Inicia sesión</Link>
                    </div>
                </div>
            </section>
        </main>
    );
}
