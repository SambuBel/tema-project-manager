# Ejecutar una prueba aislada en Windows

`probar.ps1` permite compilar y ejecutar el proyecto en PowerShell sin usar la
base habitual de desarrollo. Requiere Windows, Node.js >= 20, Docker Desktop
encendido y las dependencias instaladas con la version de pnpm del proyecto.
No depende del nombre de una rama ni de la ubicacion del checkout.

## Preparacion y arranque

Desde la raiz del checkout o worktree destinado a la prueba:

```powershell
npx --yes pnpm@9.12.0 install --frozen-lockfile
.\probar.ps1
```

Usar un checkout de prueba sin archivos `.env` en la raiz ni en las apps. El
lanzador rechaza esos archivos para no cargar configuraciones externas a la
prueba; no los borra ni los modifica. Las versiones habituales pueden seguir
usando sus propios `.env` en otro checkout.

El script pide la clave de PostgreSQL sin mostrarla. En un volumen nuevo se
usara para inicializar la base. Si el volumen ya existe, ingresar su clave
actual: cambiar este parametro no cambia la clave guardada en PostgreSQL.
Tambien se acepta `-DatabasePassword` como SecureString o la variable de proceso
`POSTGRES_PASSWORD`. No guardar claves en el repositorio ni en esta guia.

Por defecto se usan:

| Recurso | Valor |
| --- | --- |
| Frontend | http://localhost:5174 |
| API y health | http://localhost:3001/api/health |
| PostgreSQL | localhost:55432 |
| Proyecto de Compose | tema-prueba-ultimos-cambios |
| Volumen independiente | tema-prueba-ultimos-cambios_db_data |

Los puertos, el usuario y nombre de base se pueden configurar con
`-FrontendPort`, `-BackendPort`, `-DatabasePort`, `-DatabaseUser` y
`-DatabaseName`. `-ComposeProject` permite otro proyecto cuyo nombre empiece
por `tema-prueba-`. Usar un proyecto de Compose separado por cada prueba que
necesite datos independientes. No reutilizar un proyecto o volumen habitual.
El script rechaza puertos de aplicaciones ocupados antes de iniciar servidores.

## Etapas y cierre

El lanzador muestra cinco etapas: PostgreSQL, compilacion, migraciones,
catalogos y servidores. Compila mediante
`pnpm --recursive --workspace-concurrency=1 run build`, respetando el orden de
dependencias. Evita la etapa de finalizacion de cache de Turbo que podia quedar
retenida despues de completar los builds en una terminal interactiva. No se
cambia el comando general `pnpm build` del repositorio. Cualquier codigo de
salida distinto de cero interrumpe el lanzador y muestra el error.

El frontend usa Vite; el backend ejecuta la compilacion. Para probar cambios
del backend, detener y volver a ejecutar el script. Esperar el mensaje con
las URLs, que solo aparece cuando frontend y API responden. Los logs locales
`prueba-*.log` estan ignorados por Git.

Ctrl+C detiene solo los servidores iniciados por el script. La base y los
usuarios se conservan en el volumen. Para detener la base sin borrar datos:

```powershell
docker compose -p tema-prueba-ultimos-cambios -f infra/docker-compose.yml stop
```

Si se eligio otro `-ComposeProject`, usar ese mismo nombre al detener la base.

## Alcance de la configuracion

- No crea, copia ni sobrescribe archivos `.env`. Las variables del proceso se
  restauran al finalizar; el secreto de sesion se genera en cada ejecucion.
- PostgreSQL se levanta en un contenedor y volumen separados; las migraciones
  y el seed se ejecutan exclusivamente contra la conexion de prueba.
- El seed carga catalogos; no crea cuentas, contrasenas de acceso ni proyectos.
  Las cuentas ya creadas en el volumen persisten. En una base nueva hace falta
  aprovisionar un usuario para probar pantallas autenticadas.
- Google usa valores ficticios requeridos por la validacion del backend: el
  acceso con Google no esta operativo. El acceso con email y contrasena sirve
  para las cuentas que tengan una contrasena configurada.
- La IA funciona en modo demo, sin una clave de Gemini.
- Esta configuracion es para desarrollo local, no para produccion.
