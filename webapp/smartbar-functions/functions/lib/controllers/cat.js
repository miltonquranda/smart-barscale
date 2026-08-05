"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = __importDefault(require("./base"));
class CatCtrl extends base_1.default {
    constructor() {
        super(...arguments);
        this.collectionName = 'cats';
    }
}
exports.default = CatCtrl;
//# sourceMappingURL=cat.js.map