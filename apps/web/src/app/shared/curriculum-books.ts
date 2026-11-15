import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ApiService, errorMessage } from '../core/api.service';
import type { CurriculumFile } from '../core/models';
import { ToastService } from '../core/toast.service';

/** A curriculum's PDF books: open or save; staff with the right add and remove them. */
@Component({
  selector: 'app-curriculum-books',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="books">
      <ul [attr.aria-label]="name() + ' books'">
        @for (f of files.value(); track f.id) {
          <li>
            <span class="pdf" aria-hidden="true">PDF</span>
            <span class="what"
              ><strong>{{ f.title }}</strong
              ><span class="sub">{{ f.fileName }} · {{ size(f.size) }}</span></span
            >
            <button
              type="button"
              class="btn small"
              (click)="open(f)"
              [attr.aria-label]="'Open ' + f.title"
            >
              Open
            </button>
            <button
              type="button"
              class="btn small"
              (click)="open(f, true)"
              [attr.aria-label]="'Download ' + f.title"
            >
              Download
            </button>
            @if (canEdit()) {
              <button
                type="button"
                class="btn small danger"
                [disabled]="busy()"
                (click)="remove(f)"
                [attr.aria-label]="'Remove ' + f.title"
              >
                Remove
              </button>
            }
          </li>
        } @empty {
          <li class="muted">{{ files.isLoading() ? 'Loading…' : 'No books yet.' }}</li>
        }
      </ul>
      @if (canEdit()) {
        <div class="add">
          <label class="sr-only" [for]="'bt-' + curriculumId()">Book title</label>
          <input
            [id]="'bt-' + curriculumId()"
            placeholder="Title, e.g. Student book"
            [value]="title()"
            (input)="title.set($any($event.target).value)"
          />
          <label class="btn small file">
            {{ busy() ? 'Uploading…' : 'Upload PDF' }}
            <input
              type="file"
              accept="application/pdf,.pdf"
              [disabled]="busy()"
              (change)="upload($event)"
              [attr.aria-label]="'Upload a PDF to ' + name()"
            />
          </label>
          <span class="muted small">Up to 30 MB.</span>
        </div>
      }
    </div>
  `,
  styles: `
    .books {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .pdf {
      font-size: 10px;
      font-weight: 800;
      color: #fff;
      background: #c2410c;
      border-radius: 4px;
      padding: 3px 5px;
    }
    .what {
      flex: 1 1 200px;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .sub {
      font-size: 12px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .add {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .add input:not([type='file']) {
      min-height: 36px;
      padding: 0 10px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font: inherit;
      font-size: 14px;
      flex: 1 1 200px;
    }
    .file {
      position: relative;
      overflow: hidden;
      cursor: pointer;
    }
    .file input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .small {
      font-size: 12px;
    }
    .notice {
      margin: 0;
    }
  `,
})
export class CurriculumBooks {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly curriculumId = input.required<string>();
  readonly name = input('');
  readonly canEdit = input(false);

  protected readonly files = httpResource<CurriculumFile[]>(
    () => `/api/curricula/${this.curriculumId()}/files`,
    { defaultValue: [] },
  );
  protected readonly title = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected size(bytes: number) {
    return bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  protected async open(f: CurriculumFile, save = false) {
    this.error.set('');
    try {
      await this.api.openFile(
        `/api/curricula/${f.curriculumId}/files/${f.id}${save ? '?download=1' : ''}`,
        f.fileName,
        save,
      );
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async upload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      this.toast.error('The file is too big: 30 MB at most.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.uploadBook(this.curriculumId(), file, this.title());
      this.title.set('');
      this.files.reload();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(f: CurriculumFile) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.removeBook(f.curriculumId, f.id);
      this.files.reload();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
