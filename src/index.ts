import express, { Request, Response } from "express";
import axios from "axios";
import { Client, LocalAuth, Message, MessageMedia } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { GoogleGenerativeAI, ChatSession } from "@google/generative-ai";
import 'dotenv/config';

const genAI = new GoogleGenerativeAI(process.env.API_KEY!);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = 5000;

// Simpan history chat per user dan bot
const chatHistory: { [key: string]: { userMessages: string[], botMessages: string[] } } = {};

async function mediaToGenerativePart(media: MessageMedia) {
  return {
    inlineData: { data: media.data, mimeType: media.mimetype },
  };
}

const whatsappClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'], 
  },
});

whatsappClient.on("qr", (qr: string) => {
  qrcode.generate(qr, { small: true });
  console.log("QR Code received, scan with your phone.");
});

whatsappClient.on("ready", () => {
  console.log("WhatsApp Web client is ready!");
});

whatsappClient.on("message", async (msg: Message) => {
  const senderNumber: string = msg.from;
  const message: string = msg.body;

  console.log(`Received message from ${senderNumber}: ${message}`);

  // Update chat history for the sender
  if (!chatHistory[senderNumber]) {
    chatHistory[senderNumber] = { userMessages: [], botMessages: [] };
  }

  // Add new message to user chat history
  chatHistory[senderNumber].userMessages.push(message);

  // Keep only the last 3 messages (2 previous + 1 current)
  if (chatHistory[senderNumber].userMessages.length > 3) {
    chatHistory[senderNumber].userMessages.shift();  // Remove the oldest message
  }

  let mediaPart = null;
  if (msg.hasMedia) {
    const media = await msg.downloadMedia();
    mediaPart = await mediaToGenerativePart(media);
  }

  await run(chatHistory[senderNumber], senderNumber, mediaPart);
});

let chat: ChatSession | null = null;

async function run(history: { userMessages: string[], botMessages: string[] }, senderNumber: string, mediaPart?: any): Promise<void> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-8b" });

    if (!chat) {
      chat = model.startChat({
        generationConfig: {
          maxOutputTokens: 70,
          temperature: 1.4,
        },
      });
    }

    // Gabungkan 2 pesan sebelumnya + pesan terbaru dari user DAN bot jadi satu prompt
    const contextPrompt = `Jawab pesan ini dengan rasa imut, manis, seperti pacar, feminim, perempuan, bot suka dengan user. Nama bot yaitu "Naya". Jawab pesan terbaru max 25 kata. Dan jika jawaban nya melebihi maximal kata tolak saja pesan nya."\n\n` +
      `${history.userMessages.slice(0, -1).join('\n')}\n` +
      `${history.userMessages[history.userMessages.length - 1]}` +
      ``;

    let prompt: any[] = [];
    prompt.push(contextPrompt);

    if (mediaPart) {
      prompt.push(mediaPart);  // If there's media, add it too
    }

    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    const text: string = response.text();

    if (text) {
      console.log("Generated Text:", text);
      
      // Simpan balasan bot ke history
      chatHistory[senderNumber].botMessages.push(text);

      // Keep only the last 2 bot responses in history
      if (chatHistory[senderNumber].botMessages.length > 2) {
        chatHistory[senderNumber].botMessages.shift();  // Remove the oldest response
      }

      await sendWhatsAppMessage(text, senderNumber);
    } else {
      console.error("This problem is related to Model Limitations and API Rate Limits");
    }

  } catch (error) {
    console.error("Error in run function:", error);
    await sendWhatsAppMessage("Oops, an error occurred. Please try again later.", senderNumber);
  }
}

async function sendWhatsAppMessage(text: string, toNumber: string): Promise<void> {
  try {
    await whatsappClient.sendMessage(toNumber, text);
  } catch (err) {
    console.error("Failed to send WhatsApp message:");
    console.error("Error details:", err);
  }
}

app.listen(port, () => console.log(`Express app running on port ${port}!`));

whatsappClient.initialize();