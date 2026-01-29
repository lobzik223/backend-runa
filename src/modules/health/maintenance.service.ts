import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_FLAG_PATH = path.join(process.cwd(), 'data', 'maintenance.flag');

@Injectable()
export class MaintenanceService {
  private readonly flagPath: string;

  constructor() {
    this.flagPath = process.env.MAINTENANCE_FLAG_PATH || DEFAULT_FLAG_PATH;
  }

  /**
   * Режим «Ведутся работы» включён, если файл существует и его содержимое не "0".
   */
  async isEnabled(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.flagPath)) return false;
      const content = fs.readFileSync(this.flagPath, 'utf8').trim();
      return content !== '0';
    } catch {
      return false;
    }
  }

  /**
   * Включить или выключить режим обслуживания.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    const dir = path.dirname(this.flagPath);
    if (enabled) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.flagPath, '1', 'utf8');
    } else {
      if (fs.existsSync(this.flagPath)) fs.unlinkSync(this.flagPath);
    }
  }
}
