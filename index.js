import fs from "fs";
import path from "path";
import express from "express";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";

const logger = pino({ level: "silent" });
const AUTH_PATH = path.join(process.cwd(), "sesion");
let socketActivo;
let reconexionProgramada = false;
const pedidosEnCurso = new Map();

async function limpiarSesionCorrupta() {
  try {
    await fs.promises.rm(AUTH_PATH, { recursive: true, force: true });
    console.log("Sesión de WhatsApp eliminada para recrearla desde cero.");
  } catch (error) {
    console.error("No se pudo limpiar la sesión corrupta:", error);
  }
}

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    browser: Browsers.ubuntu("Chrome")
  });
  socketActivo = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr, isOnline, receivedPendingNotifications }) => {
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
      sock.sendPresenceUpdate({ presence: "available" }).catch(() => {});
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
      const errorMessage = lastDisconnect?.error?.message || "motivo desconocido";
      const esSesionCorrupta =
        codigo === DisconnectReason.badSession ||
        errorMessage.includes("MessageCounterError") ||
        errorMessage.includes("Failed to decrypt message with any known session") ||
        errorMessage.includes("session");
      const debeReconectar = codigo !== DisconnectReason.loggedOut;

      if (esSesionCorrupta) {
        console.error("Sesión corrupta detectada:", errorMessage, `(código ${codigo ?? "desconocido"})`);
        await limpiarSesionCorrupta();
      }

      if (debeReconectar && !reconexionProgramada) {
        reconexionProgramada = true;
        console.error(
          "Conexión cerrada:",
          errorMessage,
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

  const mensajesProcesados = new Set();

  async function procesarMensaje(mensaje) {
    if (!mensaje?.message) {
      console.log("Mensaje sin contenido.");
      return;
    }

    const chatId = mensaje.key?.remoteJid;
    console.log("Mensaje recibido:", {
      chatId,
      fromMe: mensaje.key?.fromMe,
      tipos: Object.keys(mensaje.message)
    });

    if (mensaje.key?.fromMe) {
      console.log("Ignorado porque fue enviado desde la cuenta del bot.");
      return;
    }

    if (!chatId || chatId === "status@broadcast") return;

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
      return;
    }

    const pedido = pedidosEnCurso.get(chatId);

    if (pedido?.estado === "orden" && texto.trim()) {
      const orden = texto.trim();
      const tieneOrdenValida = /\b(6|12)\b/.test(orden);

      if (!tieneOrdenValida) {
        await sock.sendMessage(chatId, {
          text: "Indica una orden válida: *6 alitas* o *12 alitas*."
        });
        return;
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
        return;
      }

      pedidosEnCurso.set(chatId, {
        estado: "salsa",
        orden
      });
      await sock.sendMessage(chatId, {
        text: "¿Qué salsa deseas? Responde *barbacoa* o *buffalo*."
      });
      return;
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
        return;
      }

      pedidosEnCurso.set(chatId, {
        estado: "nombre",
        orden: pedido.orden,
        salsa: salsaElegida
      });
      await sock.sendMessage(chatId, {
        text: "Perfecto. Ahora escribe tu nombre."
      });
      return;
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
      return;
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
      return;
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
      return;
    }

    if (comando === "hola" || comando === "buenas") {
      await sock.sendMessage(chatId, {
        text: "¡Bienvenido a *Hootswing Cocinas Legendarias*! 🍗 Escribe *menu* para conocer nuestras opciones."
      });
      return;
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
      return;
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
      return;
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
      return;
    }

    if (comando) {
      await sock.sendMessage(chatId, {
        text: "¡Bienvenido a *Hootswing Cocinas Legendarias*! 🍗 Escribe *menu* para ver las órdenes de 6 y 12 alitas, o *ayuda* para hacer tu pedido."
      });
    }
  }

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    // "append" contiene mensajes históricos/sincronizados y puede llegar tarde.
    // Solo "notify" corresponde a mensajes nuevos recibidos en tiempo real.
    if (type !== "notify") return;

    for (const mensaje of messages) {
      const mensajeKey = `${mensaje?.key?.remoteJid ?? "sin-chat"}:${mensaje?.key?.id ?? "sin-id"}`;
      if (mensajesProcesados.has(mensajeKey)) continue;

      mensajesProcesados.add(mensajeKey);
      setImmediate(async () => {
        try {
          await procesarMensaje(mensaje);
        } catch (error) {
          console.error("Error al procesar mensaje:", error);
        } finally {
          mensajesProcesados.delete(mensajeKey);
        }
      });
    }
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("El bot de WhatsApp está vivo y corriendo 24/7");
});

app.listen(PORT, () => {
  console.log(`Servidor web escuchando en el puerto ${PORT}`);
});

iniciarBot().catch((error) => {
  console.error("No se pudo iniciar el bot:", error);
  process.exitCode = 1;
});