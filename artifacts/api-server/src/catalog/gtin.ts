// Barcode parsing kept free of database imports so search code and tests
// can use it without a database connection.
export type ParsedBarcode = { canonical: string; candidates: string[] };

/**
 * Normalizes a scanned or typed barcode.
 * Phones often read US products as 12-digit UPC-A ("851939002067") while
 * databases store the 13-digit EAN form ("0851939002067"). We store the
 * 13-digit form and search for both.
 */
export function parseBarcode(raw: string): ParsedBarcode | "invalid_format" | "invalid_check_digit" {
  const digits = raw.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return "invalid_format";
  if (!hasValidCheckDigit(digits)) return "invalid_check_digit";
  let canonical = digits;
  if (digits.length === 12) canonical = `0${digits}`;
  if (digits.length === 14 && digits.startsWith("0")) canonical = digits.slice(1);
  const candidates = new Set([digits, canonical]);
  if (canonical.length === 13 && canonical.startsWith("0")) candidates.add(canonical.slice(1));
  return { canonical, candidates: [...candidates] };
}

function hasValidCheckDigit(code: string) {
  const digits = code.split("").map(Number);
  const check = digits.pop();
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
