import { PrismaService } from '../../database/prisma.service';
export declare class UsersService {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(): Promise<{
        id: string;
        username: string;
        fullName: string;
        role: string;
        isActive: boolean;
        avatarUrl: string;
        lastLogin: Date;
        createdAt: Date;
    }[]>;
    findById(id: string): Promise<{
        id: string;
        username: string;
        fullName: string;
        role: string;
        isActive: boolean;
        avatarUrl: string;
        lastLogin: Date;
        createdAt: Date;
    }>;
    create(data: {
        username: string;
        password: string;
        fullName: string;
        role: string;
    }): Promise<{
        id: string;
        username: string;
        fullName: string;
        role: string;
        isActive: boolean;
        createdAt: Date;
    }>;
    update(id: string, data: {
        fullName?: string;
        role?: string;
        isActive?: boolean;
        password?: string;
    }): Promise<{
        id: string;
        username: string;
        fullName: string;
        role: string;
        isActive: boolean;
        createdAt: Date;
    }>;
    delete(id: string): Promise<{
        id: string;
        username: string;
        passwordHash: string;
        fullName: string;
        role: string;
        isActive: boolean;
        avatarUrl: string | null;
        lastLogin: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
