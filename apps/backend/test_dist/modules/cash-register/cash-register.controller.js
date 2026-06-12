"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CashRegisterController = void 0;
const common_1 = require("@nestjs/common");
const cash_register_service_1 = require("./cash-register.service");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
let CashRegisterController = class CashRegisterController {
    constructor(cashService) {
        this.cashService = cashService;
    }
    open(req, dto) {
        return this.cashService.open(req.user.sub, dto);
    }
    close(sessionId, req, dto) {
        return this.cashService.close(sessionId, req.user.sub, dto);
    }
    getCurrent(req) { return this.cashService.getCurrentSession(req.user.sub); }
    getHistory(userId, from, to) {
        return this.cashService.getHistory({ userId, from, to });
    }
    addMovement(sessionId, req, dto) {
        return this.cashService.addCashMovement(sessionId, req.user.sub, dto);
    }
};
exports.CashRegisterController = CashRegisterController;
__decorate([
    (0, common_1.Post)('open'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CashRegisterController.prototype, "open", null);
__decorate([
    (0, common_1.Post)(':sessionId/close'),
    __param(0, (0, common_1.Param)('sessionId')),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], CashRegisterController.prototype, "close", null);
__decorate([
    (0, common_1.Get)('current'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CashRegisterController.prototype, "getCurrent", null);
__decorate([
    (0, common_1.Get)('history'),
    __param(0, (0, common_1.Query)('userId')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], CashRegisterController.prototype, "getHistory", null);
__decorate([
    (0, common_1.Post)(':sessionId/movement'),
    __param(0, (0, common_1.Param)('sessionId')),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], CashRegisterController.prototype, "addMovement", null);
exports.CashRegisterController = CashRegisterController = __decorate([
    (0, common_1.Controller)('cash'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [cash_register_service_1.CashRegisterService])
], CashRegisterController);
//# sourceMappingURL=cash-register.controller.js.map