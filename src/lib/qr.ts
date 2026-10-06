import QRCode from 'qrcode';

export function tipUrl(appUrl: string, slug: string, source: 'qr' | 'nfc' = 'qr'): string {
  return `${appUrl.replace(/\/$/, '')}/t/${slug}?s=${source}`;
}

export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#14161a', light: '#ffffff' } });
}

export async function qrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 1024 });
}
