// Formatos de identificadores impresos en etiquetas
export const pad = (n, d = 3) => String(n).padStart(d, '0');
export const idBolsa = (ot, k) => `${ot}-B${pad(k)}`;
export const charolaDe = (k, porCharola) => Math.ceil(k / porCharola);
