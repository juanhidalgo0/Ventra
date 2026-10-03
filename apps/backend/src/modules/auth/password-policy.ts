import { BadRequestException } from '@nestjs/common';

/** Las claves son numéricas: menos de 4 dígitos se adivina enseguida. */
export const MIN_PASSWORD_DIGITS = 4;

export function assertValidPassword(password: string) {
  if (!/^\d+$/.test(String(password || ''))) throw new BadRequestException('La contraseña debe contener solo números');
  if (password.length < MIN_PASSWORD_DIGITS) throw new BadRequestException(`La contraseña debe tener al menos ${MIN_PASSWORD_DIGITS} números`);
}
