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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddBridgeDto = void 0;
const class_validator_1 = require("class-validator");
class AddBridgeDto {
}
exports.AddBridgeDto = AddBridgeDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^(0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[1-9A-HJ-NP-Za-km-z]{32,44})$/, {
        message: 'address must be a valid EVM / TRON / Solana address',
    }),
    __metadata("design:type", String)
], AddBridgeDto.prototype, "address", void 0);
__decorate([
    (0, class_validator_1.Matches)(/^[a-z0-9_-]{2,32}$/, { message: 'bridge must be a slug like orbiter / debridge / lifi' }),
    __metadata("design:type", String)
], AddBridgeDto.prototype, "bridge", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    __metadata("design:type", String)
], AddBridgeDto.prototype, "name", void 0);
//# sourceMappingURL=add-bridge.dto.js.map