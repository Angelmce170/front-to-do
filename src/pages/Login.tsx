import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";

export default function Login() {
  const nav = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);

  const hasSavedSession = Boolean(localStorage.getItem("token"));

  useEffect(() => {
    const updateStatus = () => setOnline(navigator.onLine);

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  function enterWithSavedSession(token: string) {
    localStorage.setItem("token", token);
    setAuth(token);
    nav("/dashboard");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    setError("");
    setLoading(true);

    const savedToken = localStorage.getItem("token");

    if (savedToken && (!navigator.onLine || !email.trim() || !password)) {
      enterWithSavedSession(savedToken);
      setLoading(false);
      return;
    }

    if (!navigator.onLine) {
      setError("Sin conexión. Inicia sesión con internet una vez antes de usar el modo offline.");
      setLoading(false);
      return;
    }

    try {
      const { data } = await api.post(
        "/auth/login",
        { email, password },
        { timeout: 3500 }
      );

      localStorage.setItem("token", data.token);
      if (data.user) localStorage.setItem("user", JSON.stringify(data.user));

      setAuth(data.token);

      nav("/dashboard");
    } catch (err: unknown) {
      const requestError = err as { response?: { data?: { message?: string } } };
      if (!requestError.response && savedToken) {
        enterWithSavedSession(savedToken);
        return;
      }

      setError(
        requestError.response?.data?.message || "Error al iniciar sesión"
      );
    } finally {
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
            <p className="login-eyebrow">ORGANIZA TU DÍA</p>
            <h1>Todo en orden.</h1>
            <p>Un espacio simple para enfocarte y avanzar.</p>
          </div>

          <div className="login-status">
            <span />
            Disponible incluso sin conexión
          </div>
        </div>

        <div className="login-form-panel">
          <div className="login-heading">
            <p className="login-eyebrow">BIENVENIDO</p>
            <h2>Inicia sesión</h2>
            <p>Continúa donde te quedaste.</p>
          </div>

          <form className="login-form" onSubmit={onSubmit}>
            <label htmlFor="email">Correo electrónico</label>
            <input
              id="email"
              type="email"
              placeholder="nombre@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required={!hasSavedSession}
            />

            <label htmlFor="password">Contraseña</label>
            <div className="login-password">
              <input
                id="password"
                type={show ? "text" : "password"}
                placeholder="Ingresa tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required={!hasSavedSession}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label="Mostrar u ocultar contraseña"
              >
                {show ? "Ocultar" : "Mostrar"}
              </button>
            </div>

            {error && <div className="login-alert">{error}</div>}

            <button
              type="submit"
              className="login-submit"
              disabled={loading}
            >
              {loading ? "Iniciando sesión..." : hasSavedSession && !online ? "Entrar sin conexión" : "Iniciar sesión"}
              {!loading && <span aria-hidden="true">→</span>}
            </button>
          </form>

          <div className="login-footer">
            <span>¿No tienes una cuenta?</span>
            <Link to="/register">Crear cuenta</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
