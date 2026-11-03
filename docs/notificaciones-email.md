# Notificaciones por email

El backend genera emails desde los mismos eventos que crean notificaciones in-app. Se respetan las
preferencias por tipo del usuario; desactivar un tipo impide ambos canales. Por defecto, el canal email
incluye asignaciones, menciones, comentarios en tareas propias, vencimientos, umbrales presupuestarios y
desvíos rojos. `EMAIL_NOTIFICATION_TYPES` permite cambiar esa lista por nombres separados por comas.

## Modo de prueba

El valor predeterminado de `EMAIL_NOTIFICATIONS_MODE` es `log`. En ese modo no se conecta a ningún servidor
SMTP: escribe destinatario, asunto y cuerpo del correo en el log del backend. Es solo para desarrollo,
porque el contenido puede incluir información del proyecto.

## Activar SMTP

Cuando TEMA confirme la cuenta remitente, configurar en `apps/backend/.env`:

```dotenv
EMAIL_NOTIFICATIONS_MODE=smtp
EMAIL_FROM=tema@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tema@example.com
SMTP_PASSWORD=<contraseña-de-aplicación>
```

Para Gmail, usar una cuenta con verificación en dos pasos y una contraseña de aplicación. No guardar
credenciales reales en el repositorio. La aplicación valida que estén completas al iniciar en modo SMTP.

Las alertas automáticas de vencimiento, presupuesto y desvío siguen sujetas a sus reglas e intervalos
existentes; cambiar `EMAIL_NOTIFICATION_TYPES` solo configura si ese evento también genera email, no crea
eventos adicionales.
