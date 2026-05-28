import type { SystemConfig, GenerateTask } from '@/types';

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

async function chatCompletion(config: SystemConfig, messages: ChatMessage[]): Promise<string> {
  const url = `${config.yunwuBaseUrl}/chat/completions`;

  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.7,
    max_tokens: 1024,
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.yunwuApiKeys[0] || ''}`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'Unknown error');
    throw new Error(`Chat API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function optimizeChinesePrompt(config: SystemConfig, chineseText: string): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a professional prompt engineer for AI image generation. Translate the user's Chinese description into an optimized English prompt suitable for text-to-image models (like DALL-E 3, Midjourney, Stable Diffusion).

Rules:
1. Output ONLY the English prompt, no explanations, no Chinese.
2. Be descriptive and vivid. Include artistic style keywords, lighting, composition details.
3. Keep it under 300 words.
4. Add relevant quality keywords like "high quality", "professional", "sharp details" at the end.
5. If the Chinese mentions a specific style, preserve it (e.g. "赛博朋克" → "cyberpunk style").
6. Structure: main subject �?environment/background �?lighting �?style �?quality.`,
    },
    {
      role: 'user',
      content: chineseText,
    },
  ];

  return chatCompletion(config, messages);
}

export async function generateImage(config: SystemConfig, task: GenerateTask): Promise<string[]> {
  const prompt = task.englishPrompt || task.chinesePrompt;
  const fullPrompt = buildFullPrompt(task, prompt);
  const modelId = task.model.id;

  if (modelId.startsWith('nano-banana')) {
    return generateViaGrsai(config, fullPrompt, task);
  }

  if (modelId.startsWith('gpt-image')) {
    return generateViaOpenAIImages(config, fullPrompt, task);
  }

  return generateViaGemini(config, fullPrompt, modelId);
}

function buildFullPrompt(task: GenerateTask, basePrompt: string): string {
  let prompt = basePrompt;

  if (task.stylePreset?.modifier) {
    prompt = `${task.stylePreset.modifier} ${prompt}`;
  }

  if (task.negativePrompt.trim()) {
    prompt += ` Avoid: ${task.negativePrompt}`;
  }

  return prompt;
}

async function generateViaOpenAIImages(config: SystemConfig, prompt: string, task: GenerateTask): Promise<string[]> {
  const url = `${config.yunwuBaseUrl}/images/generations`;

  const size = getOpenAISize(task);

  const body = JSON.stringify({
    model: task.model.id,
    prompt: `${prompt}, ${task.aspectPreset.ratio} aspect ratio`,
    size,
    quality: 'medium',
    n: 1,
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.yunwuApiKeys[0] || ''}`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'Unknown error');
    throw new Error(`Image generation failed: ${resp.status} ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const urls: string[] = [];

  if (data.data) {
    for (const item of data.data) {
      if (item.url) {
        urls.push(item.url);
      } else if (item.b64_json) {
        urls.push(`data:image/png;base64,${item.b64_json}`);
      }
    }
  }

  return urls;
}

async function generateViaGemini(config: SystemConfig, prompt: string, modelId: string): Promise<string[]> {
  const cleanBase = config.yunwuBaseUrl.replace(/\/v1(?:beta|alpha)?\/?$/, '').replace(/\/$/, '');
  const url = `${cleanBase}/v1beta/models/${modelId}:generateContent`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.yunwuApiKeys[0] || ''}`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'Unknown error');
    throw new Error(`Gemini image failed: ${resp.status} ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const urls: string[] = [];

  const candidates = data.candidates || [];
  for (const c of candidates) {
    for (const p of c.content?.parts || []) {
      if (p.inlineData?.data) {
        urls.push(`data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`);
      }
    }
  }

  return urls;
}

async function generateViaGrsai(config: SystemConfig, prompt: string, task: GenerateTask): Promise<string[]> {
  const body = JSON.stringify({
    model: task.model.id,
    prompt,
    aspectRatio: task.aspectPreset.ratio,
    imageSize: task.resolution,
    shutProgress: false,
  });

  const resp = await fetch(config.grsaiApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.grsaiApiKeys[0] || ''}`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => 'Unknown error');
    throw new Error(`Grsai image failed: ${resp.status} ${text.slice(0, 300)}`);
  }

  const rawText = await resp.text();

  const chunks = rawText.split('\n').filter((line) => line.startsWith('data: '));
  const results: { url?: string; image_url?: string; results?: { url?: string }[] }[] = [];
  for (const chunk of chunks) {
    try {
      const obj = JSON.parse(chunk.slice(6));
      results.push(obj);
    } catch {
      // skip bad JSON
    }
  }

  const finalResult = results[results.length - 1];
  if (!finalResult) {
    throw new Error('Grsai response had no valid data chunks');
  }

  const url =
    finalResult.url ||
    finalResult.image_url ||
    finalResult.results?.[0]?.url ||
    '';

  return url ? [url] : [];
}

function getOpenAISize(task: GenerateTask): string {
  const { width, height } = task.aspectPreset;
  const mult = task.resolution === '2K' ? 2 : task.resolution === '4K' ? 4 : 1;
  const w = width * mult;
  const h = height * mult;

  if (w === 1024 && h === 1024) return '1024x1024';
  if (w >= h) return '1792x1024';
  return '1024x1792';
}

export async function testConnection(config: SystemConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const url = `${config.yunwuBaseUrl}/models`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${config.yunwuApiKeys[0] || ''}` },
    });
    if (resp.ok) {
      return { ok: true, message: 'Yunwu 连接成功' };
    }
    return { ok: false, message: `Yunwu 返回 ${resp.status}` };
  } catch (e) {
    try {
      const resp = await fetch(config.grsaiApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.grsaiApiKeys[0] || ''}`,
        },
        body: JSON.stringify({ prompt: 'test', model: 'nano-banana-2', shutProgress: false }),
      });
      if (resp.ok || resp.status === 400) {
        return { ok: true, message: 'Grsai 连接正常' };
      }
      return { ok: false, message: `Grsai 返回 ${resp.status}` };
    } catch (e2) {
      return { ok: false, message: `所有引擎连接失败: ${e}` };
    }
  }
}
