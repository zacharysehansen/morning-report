// Schema validation for scraped results. We require a non-empty array of
// objects, each carrying every expected key with a non-empty value.

export function validateItems(data, requiredKeys) {
  if (!Array.isArray(data)) return { ok: false, reason: "output is not a JSON array" };
  if (data.length === 0) return { ok: false, reason: "array is empty" };

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, reason: `item ${i} is not an object` };
    }
    for (const key of requiredKeys) {
      const value = item[key];
      if (value === undefined || value === null || value === "") {
        return { ok: false, reason: `item ${i} is missing key "${key}"` };
      }
    }
  }

  return { ok: true };
}
