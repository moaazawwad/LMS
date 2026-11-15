import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ApiService, errorMessage } from '../core/api.service';
import type { HomeworkFile } from '../core/models';
import { ToastService } from '../core/toast.service';

const MAX_FILES = 3;
const MAX_BYTES = 8 * 1024 * 1024;

function sizeText(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Files attached to a homework answer. The student adds and removes them
 * (until the teacher replies); the teacher and the academy download them.
 */
@Component({
  selector: 'app-homework-files',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (files.value().length || canEdit()) {
      <div class="files" role="group" aria-label="Attached files">
        @if (files.value().length) {
          <ul>
            @for (f of files.value(); track f.id) {
              <li>
                <button
                  type="button"
                  class="link"
                  (click)="download(f)"
                  [attr.aria-label]="'Download ' + f.fileName"
                >
                  {{ f.fileName }}
                </button>
                <span class="muted small">{{ kind(f) }} · {{ size(f.size) }}</span>
                @if (canEdit()) {
                  <button
                    type="button"
                    class="btn small"
                    [disabled]="busy()"
                    [attr.aria-label]="'Remove ' + f.fileName"
                    (click)="remove(f)"
                  >
                    Remove
                  </button>
                }
              </li>
            }
          </ul>
        }
        @if (canEdit() && files.value().length < max) {
          <label class="btn small pick">
            {{ busy() ? 'Uploading…' : 'Attach a photo, PDF or recording' }}
            <input
              type="file"
              accept="image/*,application/pdf,audio/*"
              [disabled]="busy()"
              (change)="add($event)"
            />
          </label>
          <span class="muted small">Up to {{ max }} files, 8 MB each.</span>
        }
      </div>
    }
  `,
  styles: `
    .files {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-start;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
    }
    li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 10px;
    }
    .link {
      border: 0;
      background: none;
      padding: 0;
      font: inherit;
      color: var(--primary);
      text-decoration: underline;
      cursor: pointer;
      text-align: left;
      word-break: break-all;
    }
    .small {
      font-size: 13px;
    }
    .pick {
      position: relative;
      overflow: hidden;
      cursor: pointer;
    }
    .pick input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .notice {
      margin: 0;
    }
  `,
})
export class HomeworkFiles {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly lessonId = input.required<string>();
  /** the student, before the teacher replies */
  readonly canEdit = input(false);
  protected readonly max = MAX_FILES;
  protected readonly files = httpResource<HomeworkFile[]>(
    () => `/api/lessons/${this.lessonId()}/homework/files`,
    { defaultValue: [] },
  );
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly size = sizeText;

  protected kind(f: HomeworkFile) {
    if (f.contentType.startsWith('image/')) return 'Photo';
    if (f.contentType.startsWith('audio/')) return 'Recording';
    return 'PDF';
  }

  protected async add(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set('');
    if (file.size > MAX_BYTES) {
      this.toast.error(`"${file.name}" is ${sizeText(file.size)}. Files can be 8 MB at most.`);
      return;
    }
    this.busy.set(true);
    try {
      this.files.set(await this.api.uploadHomeworkFile(this.lessonId(), file));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(f: HomeworkFile) {
    this.busy.set(true);
    this.error.set('');
    try {
      this.files.set(await this.api.removeHomeworkFile(this.lessonId(), f.id));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async download(f: HomeworkFile) {
    this.error.set('');
    try {
      await this.api.downloadHomeworkFile(this.lessonId(), f);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}
