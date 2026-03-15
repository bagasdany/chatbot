import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testEmbed() {
  try {
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: 'Hello, world!',
    });
    console.log(JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

testEmbed();
