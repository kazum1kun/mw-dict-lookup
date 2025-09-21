export const handler = async (event) => {
  try {
    // Allow both GET ?word=... and POST { word: ... }
    let word = "";
    if (event.httpMethod === "GET") {
      const params = new URLSearchParams(event.rawQuery || "");
      word = (params.get("word") || "").trim();
    } else if (event.httpMethod === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      word = (body.word || "").trim();
    }

    if (!word) {
      return json(400, { error: "Missing 'word' parameter." });
    }

    const key = process.env.MW_COLLEGIATE_KEY;
    if (!key) {
      return json(500, { error: "Server not configured: missing MW_COLLEGIATE_KEY." });
    }

    const url = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, { timeout: 10000 });
    if (!resp.ok) {
      return json(resp.status, { error: `Upstream error ${resp.status}` });
    }

    const data = await resp.json();

    // Helper to normalize words for matching (drop punctuation/hyphens/spaces, lowercase)
    const norm = (s) => (s || "")
      .toLowerCase()
      .replace(/[\s'‘’"“”\-_.]/g, "");

    // Distinguish between real entries (objects) and suggestions (strings)
    const objects = Array.isArray(data) ? data.filter((x) => typeof x === "object" && x) : [];

    // Pull a base id like "test:1" -> "test"
    const baseId = (id) => (id || "").split(":")[0];

    // Prefer entries that exactly match the headword
    const exactMatches = objects.filter((e) => {
      const hw = e?.hwi?.hw?.replace(/\*/g, "");           // hwi.hw can contain asterisks for syllable breaks
      const id = baseId(e?.meta?.id);
      return norm(hw) === norm(word) || norm(id) === norm(word);
    });

    // Any object with definitions?
    const definitional = objects.filter((e) => Array.isArray(e.shortdef) && e.shortdef.length > 0);

    let result = {
      word,
      isWord: false,
      definitions: [],
      suggestions: [],
      source: "Merriam-Webster Collegiate Dictionary",
    };

    if (definitional.length > 0) {
      const pick = exactMatches[0] || definitional[0];
      result.isWord = true;
      result.definitions = pick.shortdef.slice(0, 5); // concise
      return json(200, result);
    }

    // If there are no definitional objects, MW returns an array of suggestion strings
    const suggestions = Array.isArray(data) ? data.filter((x) => typeof x === "string") : [];
    result.suggestions = suggestions.slice(0, 8);
    return json(200, result);
  } catch (err) {
    return json(500, { error: "Unexpected server error.", detail: String(err?.message || err) });
  }
};

// Utility to return JSON+CORS
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}
