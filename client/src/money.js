// Money arrives from the server as integer paise. We only turn it into
// rupees for display: 2500 -> "₹25.00".
export function formatPaise(paise) {
  const rupees = Math.floor(paise / 100);
  const rest = String(paise % 100).padStart(2, '0');
  return `₹${rupees}.${rest}`;
}
