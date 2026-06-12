import { Controller, Get } from '@nestjs/common';
import * as os from 'os';

@Controller('system')
export class SystemController {
  @Get('info')
  getSystemInfo() {
    const interfaces = os.networkInterfaces();
    const candidates: string[] = [];

    for (const name of Object.keys(interfaces)) {
      const lowerName = name.toLowerCase();
      // Skip virtual interfaces commonly created by Docker, WSL, VirtualBox, VMware, etc.
      if (
        lowerName.includes('virtual') || 
        lowerName.includes('vbox') || 
        lowerName.includes('virtualbox') || 
        lowerName.includes('vmware') || 
        lowerName.includes('wsl') || 
        lowerName.includes('docker') || 
        lowerName.includes('vethernet') ||
        lowerName.includes('loopback')
      ) {
        continue;
      }

      for (const iface of interfaces[name]!) {
        // Skip internal (127.0.0.1) and non-ipv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          // Skip APIPA link-local addresses (169.254.x.x)
          if (!iface.address.startsWith('169.254.')) {
            candidates.push(iface.address);
          }
        }
      }
    }

    // Choose the best candidate: prioritize standard home/office networks (192.168.* or 10.* or 172.*)
    let localIp = 'localhost';
    if (candidates.length > 0) {
      const wifiOrLan = candidates.find(ip => ip.startsWith('192.168.'));
      if (wifiOrLan) {
        localIp = wifiOrLan;
      } else {
        const otherPrivate = candidates.find(ip => ip.startsWith('10.') || ip.startsWith('172.'));
        if (otherPrivate) {
          localIp = otherPrivate;
        } else {
          localIp = candidates[0];
        }
      }
    } else {
      // Fallback: search including virtual and link-local if nothing else exists
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
          if (iface.family === 'IPv4' && !iface.internal) {
            localIp = iface.address;
            break;
          }
        }
        if (localIp !== 'localhost') break;
      }
    }

    return {
      localIp,
      serverTime: new Date(),
      platform: os.platform(),
      arch: os.arch(),
    };
  }
}
