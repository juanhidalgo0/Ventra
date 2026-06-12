"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_module_1 = require("./database/prisma.module");
const auth_module_1 = require("./modules/auth/auth.module");
const users_module_1 = require("./modules/users/users.module");
const products_module_1 = require("./modules/products/products.module");
const categories_module_1 = require("./modules/categories/categories.module");
const sales_module_1 = require("./modules/sales/sales.module");
const cash_register_module_1 = require("./modules/cash-register/cash-register.module");
const system_module_1 = require("./modules/system/system.module");
const clients_module_1 = require("./modules/clients/clients.module");
const suppliers_module_1 = require("./modules/suppliers/suppliers.module");
const websocket_module_1 = require("./websockets/websocket.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: ['.env', '../../.env'],
            }),
            auth_module_1.AuthModule,
            cash_register_module_1.CashRegisterModule,
            categories_module_1.CategoriesModule,
            clients_module_1.ClientsModule,
            prisma_module_1.PrismaModule,
            products_module_1.ProductsModule,
            sales_module_1.SalesModule,
            suppliers_module_1.SuppliersModule,
            system_module_1.SystemModule,
            users_module_1.UsersModule,
            websocket_module_1.WebsocketModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map