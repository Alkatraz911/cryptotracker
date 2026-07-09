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
exports.Transaction = void 0;
const typeorm_1 = require("typeorm");
const numberTransformer = {
    to: (v) => v ?? null,
    from: (v) => (v == null ? null : Number(v)),
};
let Transaction = class Transaction {
};
exports.Transaction = Transaction;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ name: 'dedup_key' }),
    __metadata("design:type", String)
], Transaction.prototype, "dedupKey", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Transaction.prototype, "network", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Transaction.prototype, "hash", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'block_ts', type: 'bigint', nullable: true, transformer: numberTransformer }),
    __metadata("design:type", Object)
], Transaction.prototype, "blockTs", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'from_addr', type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], Transaction.prototype, "fromAddr", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'to_addr', type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], Transaction.prototype, "toAddr", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], Transaction.prototype, "asset", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'double precision', nullable: true }),
    __metadata("design:type", Object)
], Transaction.prototype, "amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'double precision', nullable: true }),
    __metadata("design:type", Object)
], Transaction.prototype, "usd", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'from_label', type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], Transaction.prototype, "fromLabel", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'to_label', type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], Transaction.prototype, "toLabel", void 0);
exports.Transaction = Transaction = __decorate([
    (0, typeorm_1.Entity)('transactions'),
    (0, typeorm_1.Index)(['network', 'fromAddr']),
    (0, typeorm_1.Index)(['network', 'toAddr']),
    (0, typeorm_1.Index)(['blockTs'])
], Transaction);
//# sourceMappingURL=transaction.entity.js.map