# Bot gratuito para WhatsApp

Bot básico hecho con Node.js y Baileys. Responde a `hola`, `menu`, `info` y `ayuda`.

## Requisitos

- Node.js 20 o superior
- Un teléfono con WhatsApp

## Instalación

Abre PowerShell en esta carpeta y ejecuta:

```powershell
npm install
npm start
```

La primera vez aparecerá un código QR en la terminal. En el teléfono abre:

**WhatsApp > Dispositivos vinculados > Vincular un dispositivo**

Después escanea el QR. La sesión se guardará en la carpeta `sesion`, así que no tendrás que escanearlo cada vez.

## Cambiar respuestas

Edita el archivo `index.js` y modifica los bloques que contienen:

```js
if (comando === "hola")
```

Para detener el bot presiona `Ctrl + C`.

> Baileys usa una conexión no oficial mediante WhatsApp Web. WhatsApp puede limitar o bloquear números que envíen mensajes masivos. Úsalo con consentimiento y preferiblemente con un número dedicado.
