import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api.service';
import { type Field, readSpreadsheet, toRecords } from '../../core/spreadsheet';

type Kind = 'students' | 'teachers';

interface Column {
  field: Field;
  label: string;
  required: boolean;
  example: string;
  help: string;
}

interface ImportResult {
  rows: { row: number; fullName: string; email: string; problems: string[] }[];
  created: { fullName: string; email: string; password: string; generated: boolean }[] | null;
}

const COLUMNS: Record<Kind, Column[]> = {
  students: [
    { field: 'fullName', label: 'Name', required: true, example: 'Sara Ali', help: 'Full name' },
    {
      field: 'email',
      label: 'Email',
      required: true,
      example: 'sara@example.com',
      help: 'They sign in with it; one account per email',
    },
    {
      field: 'timezone',
      label: 'Time zone',
      required: true,
      example: 'Toronto',
      help: 'A city (Toronto, Sydney, London) or a name like America/New_York',
    },
    {
      field: 'phone',
      label: 'Phone',
      required: false,
      example: '+1 416 555 0100',
      help: 'With the country code',
    },
    {
      field: 'password',
      label: 'Password',
      required: false,
      example: '',
      help: 'Leave empty and one is made for them',
    },
  ],
  teachers: [
    { field: 'fullName', label: 'Name', required: true, example: 'Hoda Samy', help: 'Full name' },
    {
      field: 'email',
      label: 'Email',
      required: true,
      example: 'hoda@example.com',
      help: 'They sign in with it; one account per email',
    },
    {
      field: 'level',
      label: 'Level',
      required: true,
      example: 'Premium',
      help: 'Premium, Standard or Basic',
    },
    {
      field: 'curricula',
      label: 'Curricula',
      required: false,
      example: 'Foundations 1; Reading 1',
      help: 'As named in Curricula & plans, separated by ;',
    },
    {
      field: 'hourlyRate',
      label: 'Hourly rate',
      required: false,
      example: '250',
      help: 'Pay per hour in EGP',
    },
    {
      field: 'phone',
      label: 'Phone',
      required: false,
      example: '+20 100 000 0000',
      help: 'With the country code',
    },
    {
      field: 'zoomLink',
      label: 'Class link',
      required: false,
      example: 'https://zoom.us/j/123456789',
      help: 'Their Zoom or Meet room',
    },
    {
      field: 'password',
      label: 'Password',
      required: false,
      example: '',
      help: 'Leave empty and one is made for them',
    },
  ],
};

/** A CSV cell, quoted when it needs to be. */
const cell = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Add many students or teachers from Excel or Google Sheets: pick the file,
 * see each row checked, then create all the accounts at once.
 */
@Component({
  selector: 'app-admin-import',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nav aria-label="Breadcrumb" class="muted">
        <a [routerLink]="['/admin', kind()]">{{ title() }}</a> / Import
      </nav>
      <header class="page-head">
        <div>
          <h1>Import {{ kind() }}</h1>
          <p>
            Add many {{ kind() }} at once from Excel or Google Sheets. This creates their accounts;
            {{
              kind() === 'students'
                ? "book each student's lessons from their page afterwards."
                : 'set their weekly hours from their page afterwards.'
            }}
          </p>
        </div>
      </header>

      <section class="card" aria-labelledby="imp-cols">
        <h2 id="imp-cols">1. Get the sheet ready</h2>
        <p class="muted small">
          The first row has the column names below (English or Arabic both work). Other columns are
          ignored. Up to 300 rows at a time.
        </p>
        <div class="table-wrap">
          <table class="data" style="min-width: 560px">
            <thead>
              <tr>
                <th>Column</th>
                <th>Needed</th>
                <th>Example</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              @for (c of columns(); track c.field) {
                <tr>
                  <td>
                    <strong>{{ c.label }}</strong>
                  </td>
                  <td>{{ c.required ? 'Yes' : 'No' }}</td>
                  <td class="mono">{{ c.example || '—' }}</td>
                  <td class="muted">{{ c.help }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div>
          <button type="button" class="btn" (click)="sample()">Download a sample file</button>
        </div>
      </section>

      <section class="card" aria-labelledby="imp-file">
        <h2 id="imp-file">2. Pick the file</h2>
        <div class="field">
          <label for="imp-input">Excel (.xlsx) or CSV file</label>
          <input
            id="imp-input"
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            (change)="pick($any($event.target).files?.[0])"
          />
        </div>
        @if (fileError()) {
          <p class="notice danger" role="alert">{{ fileError() }}</p>
        }
        @if (found().length) {
          <p class="small">
            Columns found: <strong>{{ found().join(', ') }}</strong>
            @if (ignored().length) {
              <span class="muted"> · not used: {{ ignored().join(', ') }}</span>
            }
          </p>
        }
      </section>

      @if (result(); as r) {
        @if (!r.created) {
          <section class="card flush" aria-labelledby="imp-check">
            <div class="card-head">
              <h2 id="imp-check">3. Check and create</h2>
              <span class="small" role="status"
                >{{ okCount() }} ready{{ badCount() ? ' · ' + badCount() + ' to fix' : '' }}</span
              >
            </div>
            <div class="table-wrap">
              <table class="data" style="min-width: 640px" aria-label="Rows in the file">
                <thead>
                  <tr>
                    <th class="r">Row</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of r.rows; track row.row) {
                    <tr [class.bad]="row.problems.length">
                      <td class="r num">{{ sheetRows[row.row - 1] ?? row.row + 1 }}</td>
                      <td>{{ row.fullName || '—' }}</td>
                      <td>{{ row.email || '—' }}</td>
                      <td>
                        @if (row.problems.length) {
                          <ul class="problems">
                            @for (p of row.problems; track p) {
                              <li>{{ p }}</li>
                            }
                          </ul>
                        } @else {
                          <span class="chip ok">ready</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="foot">
              @if (badCount()) {
                <p class="small">
                  Fix the rows marked in the file, save it, and pick it again. Nothing is created
                  until every row is ready. Row numbers match the sheet.
                </p>
              } @else {
                <p class="small">
                  All {{ okCount() }} rows are ready. Each person gets an account straight away.
                </p>
              }
              <button
                type="button"
                class="btn primary"
                [disabled]="busy() || badCount() > 0"
                (click)="create()"
              >
                {{
                  busy()
                    ? 'Creating…'
                    : 'Create ' + okCount() + (okCount() === 1 ? ' account' : ' accounts')
                }}
              </button>
            </div>
          </section>
        } @else {
          <section class="card" aria-labelledby="imp-done">
            <h2 id="imp-done">
              {{ r.created.length }} {{ r.created.length === 1 ? 'account' : 'accounts' }} created
            </h2>
            <p class="notice warn" role="note">
              <span
                >The passwords are shown only now. Download or copy them, share each one privately,
                and ask people to change it in Settings.</span
              >
            </p>
            <div class="table-wrap">
              <table class="data" style="min-width: 560px" aria-label="New accounts">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Password</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of r.created; track c.email) {
                    <tr>
                      <td>{{ c.fullName }}</td>
                      <td>{{ c.email }}</td>
                      <td class="mono">{{ c.generated ? c.password : 'the one in the file' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="actions">
              <button type="button" class="btn primary" (click)="downloadPasswords(r)">
                Download passwords (CSV)
              </button>
              <button type="button" class="btn" (click)="copy(r)">
                {{ copied() ? 'Copied' : 'Copy' }}
              </button>
              <a class="btn" [routerLink]="['/admin', kind()]">Go to {{ kind() }}</a>
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: `
    .card h2 {
      margin: 0;
    }
    .small {
      font-size: 13px;
      margin: 0;
    }
    .mono {
      font-family: ui-monospace, monospace;
      font-size: 13px;
    }
    .r {
      text-align: right;
    }
    tr.bad td {
      background: var(--danger-tint);
    }
    .problems {
      margin: 0;
      padding-left: 18px;
      color: var(--danger);
      font-size: 13px;
    }
    .foot {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      padding: 14px 18px;
      border-top: 1px solid var(--border);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    input[type='file'] {
      padding: 8px;
    }
  `,
})
export class AdminImport {
  private readonly http = inject(HttpClient);
  /** from the route */
  readonly kind = input<Kind>('students');

  protected readonly columns = computed(() => COLUMNS[this.kind()]);
  protected readonly title = computed(() => (this.kind() === 'students' ? 'Students' : 'Teachers'));
  protected readonly found = signal<string[]>([]);
  protected readonly ignored = signal<string[]>([]);
  protected readonly fileError = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly copied = signal(false);
  protected readonly result = signal<ImportResult | null>(null);
  private rows: Partial<Record<Field, string>>[] = [];
  /** where each row sits in the sheet, for messages that match what the admin sees */
  protected sheetRows: number[] = [];

  protected readonly okCount = computed(
    () => this.result()?.rows.filter((r) => !r.problems.length).length ?? 0,
  );
  protected readonly badCount = computed(
    () => this.result()?.rows.filter((r) => r.problems.length).length ?? 0,
  );

  protected async pick(file: File | undefined) {
    this.fileError.set('');
    this.error.set('');
    this.result.set(null);
    this.found.set([]);
    this.ignored.set([]);
    if (!file) return;
    try {
      const table = await readSpreadsheet(file);
      const { fields, records, sheetRows } = toRecords(table);
      const head = table[0] ?? [];
      const labels = new Map(this.columns().map((c) => [c.field, c.label]));
      this.found.set(
        fields.filter((f): f is Field => !!f && labels.has(f)).map((f) => labels.get(f)!),
      );
      this.ignored.set(head.filter((h, i) => h.trim() && (!fields[i] || !labels.has(fields[i]!))));
      const missing = this.columns().filter((c) => c.required && !fields.includes(c.field));
      if (missing.length) {
        this.fileError.set(
          `The first row needs these columns: ${missing.map((c) => c.label).join(', ')}. Check the column names, or download the sample file.`,
        );
        return;
      }
      if (!records.length) {
        this.fileError.set('The file has column names but no rows under them.');
        return;
      }
      if (records.length > 300) {
        this.fileError.set(
          `The file has ${records.length} rows. Import up to 300 at a time: split it into smaller files.`,
        );
        return;
      }
      this.rows = records;
      this.sheetRows = sheetRows;
      await this.send(false);
    } catch (err) {
      this.fileError.set(
        err instanceof Error && !('status' in err) ? err.message : errorMessage(err),
      );
    }
  }

  protected create() {
    return this.send(true);
  }

  private async send(commit: boolean) {
    this.busy.set(true);
    this.error.set('');
    try {
      this.result.set(
        await firstValueFrom(
          this.http.post<ImportResult>(`/api/import/${this.kind()}`, { rows: this.rows, commit }),
        ),
      );
    } catch (err) {
      this.error.set(errorMessage(err));
      if (!commit) this.fileError.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected sample() {
    const cols = this.columns();
    const rows = [cols.map((c) => c.label), cols.map((c) => c.example)];
    this.save(`${this.kind()}-import-sample.csv`, rows);
  }

  protected downloadPasswords(r: ImportResult) {
    const rows = [
      ['Name', 'Email', 'Password'],
      ...(r.created ?? []).map((c) => [
        c.fullName,
        c.email,
        c.generated ? c.password : '(the one in the file)',
      ]),
    ];
    this.save(`new-${this.kind()}-passwords.csv`, rows);
  }

  protected async copy(r: ImportResult) {
    const text = (r.created ?? [])
      .map(
        (c) => `${c.fullName}\t${c.email}\t${c.generated ? c.password : '(the one in the file)'}`,
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  private save(name: string, rows: string[][]) {
    // BOM so Excel opens Arabic names correctly.
    const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
