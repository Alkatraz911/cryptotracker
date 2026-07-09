import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Known bridge maker / contract address. Editable at runtime (DB row or API) so
// the registry can be extended without a rebuild. `address` is stored lowercased.
@Entity('bridge_addresses')
export class BridgeAddress {
  @PrimaryColumn()
  address!: string;

  @Column()
  bridge!: string; // 'orbiter' | 'debridge'

  @Column()
  name!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
