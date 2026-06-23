const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'signal-dashboard/1.0' } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

const IMAGES = [
  { namespace: 'pytorch',     name: 'pytorch',                  label: 'PyTorch'      },
  { namespace: 'nvidia',      name: 'cuda',                     label: 'NVIDIA CUDA'  },
  { namespace: 'ollama',      name: 'ollama',                   label: 'Ollama'       },
  { namespace: 'vllm',        name: 'vllm-openai',              label: 'vLLM'         },
  { namespace: 'huggingface', name: 'text-generation-inference', label: 'HF TGI'      },
];

async function fetchImage({ namespace, name, label }) {
  const url = `https://hub.docker.com/v2/repositories/${namespace}/${name}/`;
  const result = await fetchJson(url);
  if (result.status !== 200) return { label, pulls: 0, stars: 0 };
  return {
    label,
    pulls: result.data.pull_count ?? 0,
    stars: result.data.star_count ?? 0,
  };
}

async function getDockerData() {
  const results = await Promise.allSettled(IMAGES.map(fetchImage));
  const images = {};
  results.forEach((r, i) => {
    const label = IMAGES[i].label;
    if (r.status === 'fulfilled') {
      images[label] = { pulls: r.value.pulls, stars: r.value.stars };
    } else {
      images[label] = { pulls: 0, stars: 0 };
    }
  });
  return { images };
}

module.exports = { getDockerData };
