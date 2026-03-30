import * as dotenv from "dotenv";
import {
  ModelType,
  Chatbot
} from "../chatbot.js";

async function main() {
  dotenv.config();
  const api_key = process.env["ANTHROPIC_API_KEY"];
  if (api_key === undefined) {
    console.log("No API Key given");
  } else {
    const chatbot = new Chatbot({
      api_key: api_key,
      model_type: ModelType.Haiku,
      max_tokens: 1024,
      system_prompt: "Be concise"
    });
    console.log(await chatbot.send_recv_msg("hi"));
    console.log(await chatbot.send_recv_msg("what is your name?"));
  }
}

await main();
