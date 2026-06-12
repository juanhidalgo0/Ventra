import { UsersService } from './users.service';
declare class CreateUserDto {
    username: string;
    password: string;
    fullName: string;
    role: string;
}
declare class UpdateUserDto {
    fullName?: string;
    role?: string;
    isActive?: boolean;
    password?: string;
}
export declare class UsersController {
    private usersService;
    constructor(usersService: UsersService);
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
    create(dto: CreateUserDto): Promise<{
        id: string;
        username: string;
        fullName: string;
        role: string;
        isActive: boolean;
        createdAt: Date;
    }>;
    update(id: string, dto: UpdateUserDto): Promise<{
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
export {};
