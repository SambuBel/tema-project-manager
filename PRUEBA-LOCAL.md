# Prueba aislada de los cambios remotos

Base remota actualizada: `origin/main`, commit `d6cbb8c1502f38e52c373012df767c3c6388a1e6` (PR #79).
Rama: `prueba-ultimos-cambios`.

Los cambios locales anteriores se preservaron en `2364fa7`; la integración
se realizó mediante merge en `490bdcc`, sin conflictos de Git.
Se corrigieron errores del código integrado: se recuperó el encabezado
truncado del cliente API conservando el contenido remoto, se agregaron las
operaciones de notificaciones requeridas por los hooks, se corrigieron los
nombres `NotificationsPage.tsx` y `useNotifications.ts`, y se restauró el
proveedor `TaskDueSoonService`, conservando el import local de `UsersModule`.

Validación posterior al merge: compilación completa correcta; 15 pruebas de
frontend (API de notificaciones, paginación y login) y 155 de TasksService
pasaron. Se comprobó el arranque con la configuración de `probar.ps1`, sin
migraciones pendientes y conservando el usuario administrador. Login, sesión,
usuarios, listado de notificaciones, preferencias y contador respondieron
HTTP 200 a través del proxy; notificaciones sin sesión respondió HTTP 401.
Los servidores de verificación se detuvieron al finalizar para dejar libres
los puertos. La base independiente y sus datos quedaron conservados.

Corrección local: `NotificationsModule` ahora importa `UsersModule`. Sin ese
import, Nest no podía resolver `UsersService` para `JwtAuthGuard` y el backend
terminaba durante el arranque, aunque la compilación pasaba.

Verificado: compilación de los tres paquetes, 29 migraciones aplicadas y seed
de cinco roles y cinco rubros. Frontend, API `/api/health` y health a través
del proxy respondieron HTTP 200. Las rutas de notificaciones y preferencias
respondieron HTTP 401 sin sesión, como corresponde. Se creó el administrador
local `admin.prueba@example.com` usando `hashPassword` del proyecto (argon2id).
Se verificaron login por contraseña, sesión `/api/auth/me` y acceso ADMIN a
`/api/users` (HTTP 200), y rechazo de contraseña incorrecta (HTTP 401).
Google no se verificó.

Desde esta carpeta, en PowerShell:

```powershell
.\probar.ps1
```

El script compila, aplica migraciones y carga los catálogos en una base separada.
La compilación usa `pnpm --recursive --workspace-concurrency=1 run build`,
respetando el orden de dependencias. Se evita Turbo en este lanzador porque
una ejecución interactiva quedó retenida al finalizar la caché, aun después
de completar las tres tareas. Los mensajes `[1/5]` a `[5/5]` identifican
PostgreSQL, compilación, migraciones, catálogos y arranque respectivamente.
Inicia el frontend en http://localhost:5174 y la API en
http://localhost:3001/api/health. El backend usa la compilación: para probar
modificaciones del backend, detener el script y ejecutarlo nuevamente.
Ctrl+C detiene únicamente los dos servidores que inicia el script.
Los logs quedan en `prueba-*.log`.

No crea ni copia archivos `.env`. Las variables viven en el proceso y se
restauran al terminar. El secreto de sesión se genera nuevamente en cada inicio.
Google usa valores de prueba y no permite autenticación real. El asistente
usa modo demo. La base contiene catálogos y el administrador local de prueba,
sin los usuarios ni proyectos de la versión original; las credenciales de la
base original no sirven aquí. El administrador persiste en el volumen de
prueba y no se recrea ni se cambia su contraseña al ejecutar `probar.ps1`.

Docker debe estar encendido. El proyecto Compose se llama
`tema-prueba-ultimos-cambios`, usa el puerto `55432` y el volumen
`tema-prueba-ultimos-cambios_db_data`. El script deja esa base encendida para
conservar las pruebas. Para detenerla conservando los datos:

```powershell
docker compose -p tema-prueba-ultimos-cambios -f infra/docker-compose.yml stop
```

Las dependencias ya están instaladas usando pnpm 9.12.0 y el lockfile existente.
En este entorno (Node 24), pnpm falló en los scripts de instalación con
`readStream must be readable`. Se completó la instalación así y se comprobó
que Vite/esbuild y argon2 funcionan:

```powershell
npx --yes pnpm@9.12.0 install --frozen-lockfile --ignore-scripts
node -e "require('./apps/backend/node_modules/argon2').hash('test').then(() => console.log('argon2 OK'))"
```

La versión original se ejecuta desde `../tema-project-manager` con
`npx --yes pnpm@9.12.0 dev`, usando sus propios archivos `.env` y su base
habitual. No aplicar las migraciones de esta prueba sobre esa base.
