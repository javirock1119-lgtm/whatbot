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

## Desplegar en Render

1. Sube este proyecto a un repositorio de GitHub.
2. En Render selecciona **New > Blueprint** y conecta el repositorio.
3. Render detectará `render.yaml` y creará el Web Service.
4. Abre los logs del servicio y copia el QR que aparece en la primera ejecución.
5. En WhatsApp abre **Dispositivos vinculados > Vincular un dispositivo** y escanea el QR.

El archivo `render.yaml` configura un disco persistente para conservar la sesión de
WhatsApp entre reinicios. El disco persistente puede requerir un plan de Render
compatible; sin él tendrás que escanear un QR después de cada despliegue.

> Baileys usa una conexión no oficial mediante WhatsApp Web. WhatsApp puede limitar o bloquear números que envíen mensajes masivos. Úsalo con consentimiento y preferiblemente con un número dedicado.
