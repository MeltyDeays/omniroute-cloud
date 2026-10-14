# OmniRoute Cloud Deployment (24/7 AI Gateway)

Plantilla de despliegue en la nube para OmniRoute. Permite tener el gateway activo 24/7 sin depender de la laptop encendida.

---

### Paso 1: Subir este proyecto a tu GitHub

1. En GitHub, crea un nuevo repositorio (público o privado), por ejemplo: `omniroute-cloud`.
2. En tu terminal dentro de esta carpeta (`C:\Users\everd\Documents\Antigravity\omniroute-cloud`):
   ```bash
   git init
   git add .
   git commit -m "feat: setup omniroute cloud deployment"
   git branch -M main
   git remote add origin https://github.com/<TU_USUARIO>/omniroute-cloud.git
   git push -u origin main
   ```

---

### Paso 2: Desplegar en Render (Plan Free)

1. Ingresa a [render.com](https://render.com) e inicia sesión con GitHub.
2. Haz clic en **New +** > **Web Service**.
3. Selecciona tu repositorio `omniroute-cloud`.
4. Render detectará automáticamente el archivo `Dockerfile`:
   - **Name:** `omniroute-cloud` (o el nombre que prefieras).
   - **Region:** Selecciona la más cercana (ej. Oregon o Frankfurt).
   - **Instance Type:** `Free`.
5. En la sección **Environment Variables**, añade:
   - `STORAGE_ENCRYPTION_KEY`: `83d974394c63a347677535f4779ebe5dc9ba1195eecd62e697c2c1c9ac2d9444`
   - `OMNIROUTE_API_KEY`: `sk-bbe727d4356f358d-e5577d-28c89ab5`
6. Haz clic en **Deploy Web Service**.
7. Al terminar (toma ~2 minutos), Render te dará una URL HTTPS pública:
   `https://omniroute-cloud-xxxx.onrender.com`

---

### Paso 3: Conectar tus herramientas locales a la Nube

Una vez desplegado:

1. **Desde la terminal:**
   ```powershell
   omniroute connect https://omniroute-cloud-xxxx.onrender.com
   ```
2. **En tu archivo local `C:\Users\everd\.omniroute\.env`:**
   Actualiza la URL base:
   ```env
   OMNIROUTE_BASE_URL=https://omniroute-cloud-xxxx.onrender.com
   OMNIROUTE_API_KEY=sk-bbe727d4356f358d-e5577d-28c89ab5
   ```
3. **En `GEMINI.md`:**
   Reemplaza el endpoint local por tu URL en la nube:
   - **Endpoint Remoto:** `https://omniroute-cloud-xxxx.onrender.com/v1`
