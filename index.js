import fs from "fs";
import path from "path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";

const logger = pino({ level: "silent" });
let socketActivo;
let reconexionProgramada = false;
const pedidosEnCurso = new Map();

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState("sesion");

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome")
  });
  socketActivo = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr, isOnline, receivedPendingNotifications }) => {
    console.log("Estado de conexión:", {
      connection,
      isOnline,
      receivedPendingNotifications
    });

    if (qr) {
      console.log("\nEscanea este código QR desde WhatsApp:");
      qrcode.generate(qr, { small: true });
      console.log("El código QR caduca rápidamente; si falla, espera uno nuevo.");
    }

    if (connection === "open") {
      console.log(
        "Bot conectado correctamente como:",
        sock.user?.id || "identidad no disponible"
      );
      console.log(
        "Envía el mensaje desde otro teléfono al número anterior a la primera:"
      );
    }

    if (connection === "close") {
      if (socketActivo !== sock) return;

      socketActivo = undefined;
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const debeReconectar = codigo !== DisconnectReason.loggedOut;

      if (debeReconectar && !reconexionProgramada) {
        reconexionProgramada = true;
        console.error(
          "Conexión cerrada:",
          lastDisconnect?.error?.message || "motivo desconocido",
          `(código ${codigo ?? "desconocido"})`
        );
        console.log("Conexión cerrada. Reconectando en 3 segundos...");
        setTimeout(() => {
          reconexionProgramada = false;
          iniciarBot().catch((error) => {
            console.error("No se pudo reconectar:", error);
          });
        }, 3000);
      } else {
        console.log("Sesión cerrada. Borra la carpeta 'sesion' para volver a vincular.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    console.log(`Evento de mensajes recibido: ${type} (${messages.length})`);

    if (type !== "notify" && type !== "append") return;

    for (const mensaje of messages) {
      if (!mensaje?.message) {
        console.log("Mensaje sin contenido.");
        continue;
      }

      const chatId = mensaje.key.remoteJid;
      console.log("Mensaje recibido:", {
        chatId,
        fromMe: mensaje.key.fromMe,
        tipos: Object.keys(mensaje.message)
      });

      if (mensaje.key.fromMe) {
        console.log("Ignorado porque fue enviado desde la cuenta del bot.");
        continue;
      }

      if (!chatId || chatId === "status@broadcast") continue;

      const contenido =
        mensaje.message.ephemeralMessage?.message ||
        mensaje.message.viewOnceMessage?.message ||
        mensaje.message;
      const texto =
        contenido.conversation ||
        contenido.extendedTextMessage?.text ||
        contenido.imageMessage?.caption ||
        contenido.videoMessage?.caption ||
        "";

      const comando = texto.trim().toLowerCase();
      console.log(`Texto recibido: "${texto}"`);

      if (comando === "salir") {
        pedidosEnCurso.delete(chatId);
        await sock.sendMessage(chatId, {
          text: [
            "Has salido del pedido.",
            "",
            "*MENÚ - HOOTSWING COCINAS LEGENDARIAS* 🍗",
            "",
            "🍗 Orden de 6 alitas - 190 LPS",
            "🍗 Orden de 12 alitas - 310 LPS",
            "",
            "Salsas: barbacoa y buffalo.",
            "Acompañamientos: papas, aderezos.",
            "",
            "Escribe *quiero* para realizar un pedido."
          ].join("\n")
        });
        continue;
      }

      const pedido = pedidosEnCurso.get(chatId);

      if (pedido?.estado === "orden" && texto.trim()) {
        const orden = texto.trim();
        const tieneOrdenValida = /\b(6|12)\b/.test(orden);

        if (!tieneOrdenValida) {
          await sock.sendMessage(chatId, {
            text: "Indica una orden válida: *6 alitas* o *12 alitas*."
          });
          continue;
        }

        const salsasEnOrden = [];
        if (orden.toLowerCase().includes("barbacoa")) {
          salsasEnOrden.push("barbacoa");
        }
        if (orden.toLowerCase().includes("buffalo")) {
          salsasEnOrden.push("buffalo");
        }

        if (salsasEnOrden.length > 0) {
          pedidosEnCurso.set(chatId, {
            estado: "nombre",
            orden,
            salsa: salsasEnOrden.join(" y ")
          });
          await sock.sendMessage(chatId, {
            text: "Perfecto. Ahora escribe tu nombre."
          });
          continue;
        }

        pedidosEnCurso.set(chatId, {
          estado: "salsa",
          orden
        });
        await sock.sendMessage(chatId, {
          text: "¿Qué salsa deseas? Responde *barbacoa* o *buffalo*."
        });
        continue;
      }

      if (pedido?.estado === "salsa" && texto.trim()) {
        const salsa = texto.trim().toLowerCase();
        const salsaElegida = salsa.includes("barbacoa")
          ? "barbacoa"
          : salsa.includes("buffalo")
            ? "buffalo"
            : "";

        if (!salsaElegida) {
          await sock.sendMessage(chatId, {
            text: "No especificaste una salsa válida. Elige *barbacoa* o *buffalo*."
          });
          continue;
        }

        pedidosEnCurso.set(chatId, {
          estado: "nombre",
          orden: pedido.orden,
          salsa: salsaElegida
        });
        await sock.sendMessage(chatId, {
          text: "Perfecto. Ahora escribe tu nombre."
        });
        continue;
      }

      if (pedido?.estado === "nombre" && texto.trim()) {
        pedidosEnCurso.set(chatId, {
          estado: "direccion",
          orden: pedido.orden,
          salsa: pedido.salsa,
          nombre: texto.trim()
        });
        await sock.sendMessage(chatId, {
          text: `Gracias, ${texto.trim()}. Ahora escribe tu dirección para el pedido.`
        });
        continue;
      }

      if (pedido?.estado === "direccion" && texto.trim()) {
        pedidosEnCurso.set(chatId, {
          estado: "confirmacion",
          orden: pedido.orden,
          salsa: pedido.salsa,
          nombre: pedido.nombre,
          direccion: texto.trim()
        });
        await sock.sendMessage(chatId, {
          text: [
            "¡Perfecto! Revisa tus datos:",
            `Orden: ${pedido.orden}`,
            `Salsa: ${pedido.salsa}`,
            `Nombre: ${pedido.nombre}`,
            `Dirección: ${texto.trim()}`,
            "",
            "¿Confirmas tu pedido?",
            "Responde *si* para confirmar o *no* para cancelar."
          ].join("\n")
        });
        continue;
      }

      if (pedido?.estado === "confirmacion" && texto.trim()) {
        if (comando === "si" || comando === "sí") {
          pedidosEnCurso.delete(chatId);
          await sock.sendMessage(chatId, {
            text: [
              "¡Pedido confirmado! ✅",
              `Orden: ${pedido.orden}`,
              `Salsa: ${pedido.salsa}`,
              `Nombre: ${pedido.nombre}`,
              `Dirección: ${pedido.direccion}`,
              "",
              "Un agente confirmará los detalles y el total.",
              "",
              `¡Gracias por tu pedido, ${pedido.nombre}!`,
              "Somos Hootswing, desde las cocinas más legendarias del planeta. 🌎🍗"
            ].join("\n")
          });
          setTimeout(async () => {
            const rutaImagen = [
              path.join(process.cwd(), "img", "pedido.jpg"),
              path.join(process.cwd(), "img", "pedido.jpeg"),
              path.join(process.cwd(), "img", "pedido.png")
            ].find((ruta) => fs.existsSync(ruta));

            const mensajeChef = `Hola, ${pedido.nombre}. Su orden está en el sistema.`;

            if (rutaImagen) {
              const ext = path.extname(rutaImagen).toLowerCase();
              await sock.sendMessage(chatId, {
                image: fs.readFileSync(rutaImagen),
                mimetype: ext === ".png" ? "image/png" : "image/jpeg",
                caption: mensajeChef
              });
            } else {
              await sock.sendMessage(chatId, {
                text: mensajeChef
              });
            }
          }, 40 * 1000);

          setTimeout(async () => {
            const rutaImagen = [
              path.join(process.cwd(), "img", "chef.jpg"),
              path.join(process.cwd(), "img", "chef.jpeg"),
              path.join(process.cwd(), "img", "chef.png")
            ].find((ruta) => fs.existsSync(ruta));

            const mensajeChef = `Hola, ${pedido.nombre}. El chef ha leído su orden. 👨‍🍳`;

            if (rutaImagen) {
              const ext = path.extname(rutaImagen).toLowerCase();
              await sock.sendMessage(chatId, {
                image: fs.readFileSync(rutaImagen),
                mimetype: ext === ".png" ? "image/png" : "image/jpeg",
                caption: mensajeChef
              });
            } else {
              await sock.sendMessage(chatId, {
                text: mensajeChef
              });
            }
          }, 2 * 60 * 1000);
        } else if (comando === "no") {
          pedidosEnCurso.delete(chatId);
          await sock.sendMessage(chatId, {
            text: "Pedido cancelado. Escribe *pedido listo* cuando quieras comenzar de nuevo."
          });
        } else {
          await sock.sendMessage(chatId, {
            text: "Responde *si* para confirmar el pedido o *no* para cancelarlo."
          });
        }
        continue;
      }

      if (comando === "hola" || comando === "buenas") {
        await sock.sendMessage(chatId, {
          text: "¡Bienvenido a *Hootswing Cocinas Legendarias*! 🍗 Escribe *menu* para conocer nuestras opciones."
        });
        continue;
      }

      if (comando === "menu" || comando === "menú") {
        const menuText = [
          "*MENÚ - HOOTSWING COCINAS LEGENDARIAS* 🍗",
          "",
          "🍗 Orden de 6 alitas - 190 LPS",
          "🍗 Orden de 12 alitas - 310 LPS",
          "",
          "Salsas: barbacoa y buffalo.",
          "Acompañamientos: papas, aderezos.",
          "",
          "Escribe *info* para conocer horarios.",
          "Escribe *ayuda* para hacer un pedido."
        ].join("\n");

        const posiblesRutas = [
          path.join(process.cwd(), "img", "menu.jpg"),
          path.join(process.cwd(), "img", "menu.jpeg"),
          path.join(process.cwd(), "img", "menu.png")
        ];

        const rutaImagen = posiblesRutas.find((ruta) => fs.existsSync(ruta));

        if (rutaImagen) {
          const ext = path.extname(rutaImagen).toLowerCase();
          await sock.sendMessage(chatId, {
            image: fs.readFileSync(rutaImagen),
            mimetype: ext === ".png" ? "image/png" : "image/jpeg",
            caption: menuText
          });
        } else {
          await sock.sendMessage(chatId, {
            text: menuText
          });
        }
        continue;
      }

      if (comando === "info") {
        await sock.sendMessage(chatId, {
          text: [
            "*HOOTSWING COCINAS LEGENDARIAS* 🍗",
            "Horario: lunes a domingo, de 12:00 a 22:00.",
            "Contamos con servicio para recoger y a domicilio.",
            "Escribe *quiero* o *ayuda* para realizar tu pedido."
          ].join("\n")
        });
        continue;
      }

      if (comando === "pedido listo" || comando === "ayuda" || comando === "quiero") {
        pedidosEnCurso.set(chatId, { estado: "orden" });
        await sock.sendMessage(chatId, {
          text: [
            "¡Claro! Para hacer tu pedido, envía:",
            "1. Orden de 6 o 12 alitas.",
            "2. Puedes elegir una salsa o combinar: por ejemplo, *6 buffalo y 6 barbacoa*.",
            "3. Acompañamiento.",
            "4. Indica si recogerás tu pedido o necesitas envío a domicilio.",
            "",
            "Para comenzar, escribe *6 alitas* o *12 alitas*. También puedes indicar varias salsas."
          ].join("\n")
        });
        continue;
      }

      if (comando) {
        await sock.sendMessage(chatId, {
          text: "¡Bienvenido a *Hootswing Cocinas Legendarias*! 🍗 Escribe *menu* para ver las órdenes de 6 y 12 alitas, o *ayuda* para hacer tu pedido."
        });
      }
    }
  });
}

iniciarBot().catch((error) => {
  console.error("No se pudo iniciar el bot:", error);
  process.exitCode = 1;
});
const PORT = process.env.PORT || 3000;
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('El bot de WhatsApp está vivo y corriendo 24/7');
});

app.listen(PORT, () => {
  console.log(Servidor web escuchando en el puerto ${PORT});
});
const app = express();



app.get('/', (req, res) => {
  res.send('El bot de WhatsApp está vivo y corriendo 24/7');
});

app.listen(PORT, () => {
  console.log(`Servidor web escuchando en el puerto ${PORT}`);
});