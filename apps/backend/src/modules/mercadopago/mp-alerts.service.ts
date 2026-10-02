import { Injectable, Logger } from '@nestjs/common';
import { MercadoPagoService } from './mercadopago.service';

/**
 * El aviso de "pago de Mercado Pago sin venta" lo hace la nube (ventraMpChecks), así avisa
 * igual con la PC, la caja en la nube o las dos, sin duplicar. La nube necesita saber qué
 * medios de pago son Mercado Pago en las cajas (viven en la configuración de cada una):
 * la caja los informa y acá se mandan a la nube solo cuando cambian.
 */
@Injectable()
export class MpAlertsService {
  private readonly logger = new Logger('Avisos MP');
  private lastSent = '';

  constructor(private readonly mp: MercadoPagoService) {}

  async setMpMethods(methods: string[]) {
    const clean = [...new Set(['MERCADOPAGO', ...methods.map(String).filter(Boolean)])].slice(0, 30).sort();
    const key = clean.join(',');
    if (key === this.lastSent) return;
    try {
      await this.mp.settings({ mpMethods: clean });
      this.lastSent = key;
    } catch (err: any) {
      this.logger.warn(`No se pudieron informar los medios de Mercado Pago: ${err?.message || err}`);
    }
  }
}
