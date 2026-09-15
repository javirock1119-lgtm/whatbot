import express from 'express';
import fs from "fs";
import path from "path";
import makeWASocket, {
    Browsers,
    DisconnectReason,
    useMultiFileAuthState
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import pino from "pino";

const app = express();
const port = process.env.PORT || 3000;
const qrImagePath = path.join(process.cwd(), "qr.png");

app.get('/', (req, res) => {
  res.send('Bot de WhatsApp activo 24/7');
});

app.get("/qr.png", (req, res) => {
  res.sendFile(qrImagePath, (error) => {
    if (error && !res.headersSent) {
      res.status(error.code === "ENOENT" ? 404 : 500).send("QR no disponible");
    }
  });
});

app.listen(port, () => {
  console.log(`Servidor HTTP corriendo en el puerto ${port}`);
});

const logger = pino({ level: "silent" });
const AUTH_PATH = path.join(process.cwd(), "sesion");
const LOCK_PATH = path.join(process.cwd(), ".bot.lock");
let socketActivo;
let reconexionProgramada = false;
let lockAdquiridoPorEsteProceso = false;
const pedidosEnCurso = new Map();
const curiosidades = [
  "🌌 La luz del Sol tarda aproximadamente 8 minutos y 20 segundos en llegar a la Tierra.",
  "🧠 El cerebro humano utiliza cerca del 20% de la energía del cuerpo, aunque representa aproximadamente el 2% de su peso.",
  "🐙 Los pulpos tienen tres corazones y su sangre es azul debido a una proteína llamada hemocianina.",
  "🌳 Los árboles se comunican y pueden intercambiar nutrientes mediante redes de hongos conectadas a sus raíces.",
  "⚡ Un relámpago puede calentar el aire a temperaturas varias veces superiores a la superficie del Sol durante un instante.",
  "🛰️ Los satélites GPS necesitan corregir los efectos de la relatividad para calcular posiciones con precisión.",
  "🦋 Las mariposas prueban los sabores usando receptores ubicados en sus patas.",
  "📚 La Biblioteca de Alejandría fue uno de los centros de conocimiento más importantes del mundo antiguo.",
  "🌍 La Tierra no es una esfera perfecta: gira ligeramente ensanchada en el ecuador debido a su rotación.",
  "💧 El agua puede existir como sólido, líquido y gas, y sus propiedades hacen posible gran parte de la vida en la Tierra.",
  "🔬 Los antibióticos combaten bacterias, pero no son eficaces contra virus como los que causan la gripe o el resfriado.",
  "🧬 Casi todas las células humanas contienen el mismo ADN, pero activan diferentes genes según su función.",
  "🎼 El oído humano puede distinguir diferencias muy pequeñas de tono, lo que permite reconocer voces e instrumentos.",
  "🏛️ Muchas palabras del español proceden del latín, el árabe y las lenguas originarias de América.",
  "🤖 La inteligencia artificial aprende patrones a partir de datos; no piensa ni comprende exactamente como una persona.",
  "🌱 Las plantas convierten la luz solar en energía química mediante la fotosíntesis y liberan oxígeno como parte del proceso.",
  "🕰️ Un año en Venus dura menos que un día en Venus: tarda más en girar sobre sí mismo que en completar su órbita.",
  "🐝 Las abejas pueden comunicar la ubicación de alimento mediante una danza que indica dirección y distancia.",
  "📐 El número cero fue desarrollado de manera independiente en distintas culturas y transformó las matemáticas.",
  "🌊 El sonido viaja más rápido en el agua que en el aire porque las partículas están más juntas.",
  "☀️ La energía del Sol se produce mediante fusión nuclear, uniendo núcleos de hidrógeno para formar helio.",
  "🧭 Las brújulas apuntan aproximadamente al norte magnético, que no coincide exactamente con el norte geográfico.",
  "🦴 Los huesos son tejidos vivos: se reparan, se remodelan y almacenan minerales como calcio y fósforo.",
  "🌐 Internet es una red global de redes; la información viaja dividida en pequeños paquetes que luego se vuelven a reunir.",
  "🪐 Saturno tiene una densidad media menor que la del agua, aunque necesitaríamos una bañera gigantesca para comprobarlo.",
  "🌋 La mayor parte de la actividad volcánica de la Tierra ocurre bajo los océanos, lejos de nuestra vista.",
  "🧊 El hielo flota porque el agua se expande al congelarse y se vuelve menos densa.",
  "🦇 Los murciélagos son los únicos mamíferos capaces de realizar un vuelo verdaderamente sostenido.",
  "🔭 La luz que vemos de algunas estrellas salió de ellas hace miles o millones de años.",
  "🧩 Resolver problemas nuevos suele ser más fácil cuando se divide una tarea grande en pasos pequeños y verificables."
];
const curiosidadesTimers = new Map();

function obtenerDesglosePedido(orden) {
  const textoOrden = orden.toLowerCase().replace(/\s+/g, " ");
  const extraerCantidad = (patron) => {
    const cantidades = [];
    for (const coincidencia of textoOrden.matchAll(patron)) {
      cantidades.push(Number(coincidencia[1] || 1));
    }
    return cantidades.reduce((total, cantidad) => total + cantidad, 0);
  };

  let ordenesDeSeis = extraerCantidad(
    /(\d+)?\s*(?:órdenes?\s*(?:de\s*)?)?(?:combo\s+six|6\s+alitas)/gi
  );
  let ordenesDeDoce = extraerCantidad(
    /(\d+)?\s*(?:órdenes?\s*(?:de\s*)?)?(?:combo\s+big|12\s+alitas)/gi
  );

  if (ordenesDeSeis === 0 && ordenesDeDoce === 0) {
    ordenesDeSeis = (textoOrden.match(/\b6\b/g) || []).length;
    ordenesDeDoce = (textoOrden.match(/\b12\b/g) || []).length;
  }

  return {
    ordenesDeSeis,
    ordenesDeDoce,
    total: ordenesDeSeis * 190 + ordenesDeDoce * 310
  };
}

function obtenerTotalPedido(orden) {
  return obtenerDesglosePedido(orden).total;
}

function obtenerResumenPedido(orden, total) {
  const desglose = obtenerDesglosePedido(orden);
  const lineas = ["🍗 Resumen de tu pedido"];

  if (desglose.ordenesDeSeis > 0) {
    lineas.push(
      `* ${desglose.ordenesDeSeis} ${desglose.ordenesDeSeis === 1 ? "orden" : "órdenes"} de 6 alitas = L ${desglose.ordenesDeSeis * 190}`
    );
  }
  if (desglose.ordenesDeDoce > 0) {
    lineas.push(
      `* ${desglose.ordenesDeDoce} ${desglose.ordenesDeDoce === 1 ? "orden" : "órdenes"} de 12 alitas = L ${desglose.ordenesDeDoce * 310}`
    );
  }

  lineas.push(`💰 Total a pagar: L ${total}`);
  return lineas.join("\n");
}

async function obtenerLockDeArranque() {
  const intentarCrearLock = async () => {
    const fd = await fs.promises.open(LOCK_PATH, "wx");
    await fd.writeFile(String(process.pid));
    await fd.close();
    return true;
  };

  try {
    return await intentarCrearLock();
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    try {
      const contenido = await fs.promises.readFile(LOCK_PATH, "utf8");
      const pidAnterior = Number.parseInt(contenido.trim(), 10);
      if (!Number.isNaN(pidAnterior)) {
        try {
          process.kill(pidAnterior, 0);
          return false;
        } catch (killError) {
          if (killError && killError.code === "ESRCH") {
            await fs.promises.rm(LOCK_PATH, { force: true });
            return await intentarCrearLock();
          }
          return false;
        }
      }
    } catch (readError) {
      console.warn("No se pudo leer el lock, intentando limpiar:", readError);
    }

    await fs.promises.rm(LOCK_PATH, { force: true });
    return await intentarCrearLock();
  }
}

async function liberarLockDeArranque() {
  try {
    await fs.promises.rm(LOCK_PATH, { force: true });
  } catch (error) {
    console.error("No se pudo liberar el bloqueo de arranque:", error);
  }
}

async function limpiarSesionCorrupta() {
  try {
    await fs.promises.rm(AUTH_PATH, { recursive: true, force: true });
    console.log("Sesión de WhatsApp eliminada para recrearla desde cero.");
  } catch (error) {
    console.error("No se pudo limpiar la sesión corrupta:", error);
  }
}

async function iniciarBot() {
  await fs.promises.mkdir(AUTH_PATH, { recursive: true });

  if (socketActivo && socketActivo.ws?.readyState === 1) {
    console.log("El bot ya está conectado; no se reinicia otra instancia.");
    return;
  }

  if (!lockAdquiridoPorEsteProceso) {
    const lockAdquirido = await obtenerLockDeArranque();
    if (!lockAdquirido) {
      console.error("Otra instancia del bot ya está activa. Cierra la otra ventana o proceso antes de iniciar otra copia.");
      process.exit(1);
    }
    lockAdquiridoPorEsteProceso = true;

    process.on("exit", () => {
      liberarLockDeArranque();
    });
    process.on("SIGINT", () => {
      liberarLockDeArranque().finally(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      liberarLockDeArranque().finally(() => process.exit(0));
    });
  }

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
      await QRCode.toFile(qrImagePath, qr, {
        type: "png",
        width: 720,
        margin: 4,
        errorCorrectionLevel: "M"
      });
      console.log("\nEscanea el QR desde esta imagen:");
      console.log(`http://localhost:${port}/qr.png`);
      qrcode.generate(qr, { small: true });
      console.log("El código QR caduca rápidamente; si falla, espera uno nuevo.");
    }

    if (connection === "open") {
      reconexionProgramada = false;
      await fs.promises.rm(qrImagePath, { force: true });
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
        codigo === DisconnectReason.connectionReplaced ||
        codigo === 440 ||
        errorMessage.includes("MessageCounterError") ||
        errorMessage.includes("Failed to decrypt message with any known session") ||
        errorMessage.includes("Stream Errored (conflict)") ||
        errorMessage.includes("session");
      const debeReconectar = codigo !== DisconnectReason.loggedOut;

      if (esSesionCorrupta) {
        console.error("Sesión conflictiva o corrupta detectada:", errorMessage, `(código ${codigo ?? "desconocido"})`);
        await limpiarSesionCorrupta();
      }

      if (debeReconectar && !reconexionProgramada) {
        reconexionProgramada = true;
        console.error(
          "Conexión cerrada:",
          errorMessage,
          `(código ${codigo ?? "desconocido"})`
        );
        if (codigo === 440 || errorMessage.includes("Stream Errored (conflict)")) {
          console.log("Se detectó conflicto de sesión. Se limpiará la sesión y se pedirá QR nuevo en la próxima conexión.");
        }
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

  function enviarCuriosidadAleatoria(chatId, nombreCliente) {
    const curiosidad = curiosidades[Math.floor(Math.random() * curiosidades.length)];
    sock.sendMessage(chatId, {
      text: [
        `💡 Aquí tienes un dato curioso mientras se cocina tu pedido, ${nombreCliente || "amigo"}:`,
        "",
        curiosidad
      ].join("\n")
    }).catch(() => {});
  }

  function iniciarCuriosidadesAutomatica(chatId, nombreCliente) {
    if (curiosidadesTimers.has(chatId)) {
      clearTimeout(curiosidadesTimers.get(chatId));
    }

    const timer = setTimeout(() => {
      enviarCuriosidadAleatoria(chatId, nombreCliente);
      curiosidadesTimers.delete(chatId);
    }, 3 * 60 * 1000);

    curiosidadesTimers.set(chatId, timer);
  }

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
      const timer = curiosidadesTimers.get(chatId);
      if (timer) {
        clearTimeout(timer);
        curiosidadesTimers.delete(chatId);
      }
      await sock.sendMessage(chatId, {
        text: [
          "Has salido del pedido.",
          "",
          "*MENÚ - HOOTSWING COCINAS LEGENDARIAS* 🍗",
          "",
          "🍗 6 alitas con papas - L 190",
          "🍗 12 alitas con papas - L 310",
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
      const tieneOrdenValida = /\b(6|12|six|big)\b/i.test(orden);

      if (!tieneOrdenValida) {
        await sock.sendMessage(chatId, {
          text: "Indica un combo válido: *Combo Six* o *Combo Big*."
        });
        return;
      }

      const total = obtenerTotalPedido(orden);
      const resumen = obtenerResumenPedido(orden, total);
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
          total,
          resumen,
          salsa: salsasEnOrden.join(" y ")
        });
        await sock.sendMessage(chatId, {
          text: "Perfecto. Ahora escribe tu nombre."
        });
        return;
      }

      pedidosEnCurso.set(chatId, {
        estado: "salsa",
        orden,
        total,
        resumen
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
        total: pedido.total,
        resumen: pedido.resumen,
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
        total: pedido.total,
        resumen: pedido.resumen,
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
        total: pedido.total,
        resumen: pedido.resumen,
        salsa: pedido.salsa,
        nombre: pedido.nombre,
        direccion: texto.trim()
      });
      await sock.sendMessage(chatId, {
        text: [
          "¡Perfecto! Revisa tus datos:",
          pedido.resumen,
          `Salsa: ${pedido.salsa}`,
          `Nombre: ${pedido.nombre}`,
          `Dirección: ${texto.trim()}`,
          "",
          "¿Deseas confirmar tu pedido?",
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
            pedido.resumen,
            `Salsa: ${pedido.salsa}`,
            `Nombre: ${pedido.nombre}`,
            `Dirección: ${pedido.direccion}`,
            "",
            "Un agente confirmará los detalles del pedido.",
            "",
            `¡Gracias por tu pedido, ${pedido.nombre}!`,
            "Somos Hootswing, desde las cocinas más legendarias del planeta. 🌎🍗"
          ].join("\n")
        });

        iniciarCuriosidadesAutomatica(chatId, pedido.nombre);

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
        const timer = curiosidadesTimers.get(chatId);
        if (timer) {
          clearTimeout(timer);
          curiosidadesTimers.delete(chatId);
        }
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
        "🍗 6 alitas con papas - L 190",
        "🍗 12 alitas con papas - L 310",
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
          "1. Indica cuántas órdenes de 6 o 12 alitas deseas.",
          "2. Puedes elegir una salsa o combinar: por ejemplo, *6 buffalo y 6 barbacoa*.",
          "3. Acompañamiento papas aderezo.",
          
          "Ejemplo: *2 órdenes de 6 alitas y 1 orden de 12 alitas*."
        ].join("\n")
      });
      return;
    }

    if (comando) {
      await sock.sendMessage(chatId, {
        text: "¡Bienvenido a *Hootswing Cocinas Legendarias*! 🍗 Escribe *menu* para ver nuestras opciones, o *ayuda* para hacer tu pedido."
      });
    }
  }

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    // En WhatsApp no siempre llega como "notify"; a veces entra como "append".
    // Procesamos ambos tipos para no perder mensajes nuevos o históricos relevantes.
    if (type && !["notify", "append"].includes(type)) return;

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

iniciarBot().catch((error) => {
  console.error("No se pudo iniciar el bot:", error);
  process.exitCode = 1;
});