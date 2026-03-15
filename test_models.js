import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function listModels() {
  try {
    const aiResponse = await ai.models.list();
    let found = false;
    for await (const model of aiResponse) {
      if (model.name.includes('embed')) {
        console.log(`Model: ${model.name}`);
        found = true;
      }
    }
    if (!found) console.log("No embedding models found");
  } catch (error) {
    console.error('Error fetching models:', error.message);
  }
}

listModels();
