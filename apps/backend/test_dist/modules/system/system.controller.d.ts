export declare class SystemController {
    getSystemInfo(): {
        localIp: string;
        serverTime: Date;
        platform: NodeJS.Platform;
        arch: string;
    };
}
