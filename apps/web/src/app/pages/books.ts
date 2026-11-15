import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { BookGroup } from '../core/models';
import { CurriculumBooks } from '../shared/curriculum-books';

/** Teachers and students: the PDF books of the curricula they teach or study. */
@Component({
  selector: 'app-books',
  imports: [CurriculumBooks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Books</h1>
          <p>The books of your curricula. Open one to read it, or download it.</p>
        </div>
      </header>
      @for (g of books.value(); track g.curriculumId) {
        <section class="card" [attr.aria-labelledby]="'bk-' + g.curriculumId">
          <h2 [id]="'bk-' + g.curriculumId">{{ g.curriculum }}</h2>
          <app-curriculum-books [curriculumId]="g.curriculumId" [name]="g.curriculum" />
        </section>
      } @empty {
        <p class="empty">
          {{
            books.isLoading()
              ? 'Loading…'
              : 'No books yet. The academy adds them to each curriculum.'
          }}
        </p>
      }
    </div>
  `,
  styles: `
    h2 {
      margin: 0 0 12px;
      font-size: 17px;
    }
  `,
})
export class Books {
  protected readonly books = httpResource<BookGroup[]>(() => '/api/my-books', { defaultValue: [] });
}
