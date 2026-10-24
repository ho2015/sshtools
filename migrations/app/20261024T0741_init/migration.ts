#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/7a569809243314cc2b72d0c8d010d6b550d77e2b4a8d70303825cde3abfe00a6/contract';
import endContract from '../../snapshots/7a569809243314cc2b72d0c8d010d6b550d77e2b4a8d70303825cde3abfe00a6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, unique } from '@prisma/orm-sqlite/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        table: 'User',
        columns: [
          col('email', 'TEXT', { notNull: true, codecRef: { codecId: 'sqlite/text@1' } }),
          col('id', 'INTEGER PRIMARY KEY AUTOINCREMENT'),
        ],
        constraints: [unique(['email'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
