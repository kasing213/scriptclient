(async () => {
  const { OpenAI } = require('openai');
  require('dotenv').config();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const chatCompletion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: "Say hi in Khmer" }],
  });

  console.log(chatCompletion.choices[0].message.content);
})();
