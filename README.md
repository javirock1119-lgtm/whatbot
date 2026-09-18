# Bot gratuito para WhatsApp

Bot básico hecho con Node.js y Baileys. Responde a `hola`, `menu`, `info` y `ayuda`.

## Requisitos

- Node.js 20 o superior
- Un teléfono con WhatsApp

## Instalación en Linux

En la laptop Linux que funcionará como servidor:

```bash
sudo apt update
sudo apt install -y nodejs npm
node --version
npm --version
```

Node.js 20 o superior es recomendado. Después clona e inicia el bot:

```bash
git clone https://github.com/javirock1119-lgtm/whatbot.git
cd whatbot
npm ci
mkdir -p /opt/whatbot-data
BOT_DATA_PATH=/opt/whatbot-data npm start
```

La variable `BOT_DATA_PATH` conserva la sesión y el QR fuera del código. También
puedes definirla permanentemente con un archivo `.env` gestionado por tu servicio
de Linux. No subas ese archivo a GitHub si contiene `MONGODB_URI`.

El servidor HTTP escucha en todas las interfaces en el puerto `3000`. Desde otro
dispositivo de la misma red abre:

```text
http://IP-DE-LA-LAPTOP:3000/qr.png
```

Si utilizas UFW, permite el puerto:

```bash
sudo ufw allow 3000/tcp
```

## Instalación en Windows

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
