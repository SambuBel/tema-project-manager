import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('exchange_rates')
@Index('ux_exchange_rates_pair_date', ['fromCurrency', 'toCurrency', 'effectiveDate'], { unique: true })
export class ExchangeRateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'from_currency', type: 'varchar', length: 3 })
  fromCurrency!: string;

  @Column({ name: 'to_currency', type: 'varchar', length: 3 })
  toCurrency!: string;

  @Column({ name: 'rate', type: 'numeric', precision: 18, scale: 6 })
  rate!: string;

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
