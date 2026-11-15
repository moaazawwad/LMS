# الشغل من أكتر من جهاز وأكتر من أكونت Claude

المشروعين (الـLMS والموقع) بيتحفظوا على **GitHub كـ Private repo**. كل جهاز بياخد نسخة، وكل التعديلات بتتجمع هناك.

## مرة واحدة: رفع المشروعين على GitHub

1. اعمل أكونت على github.com لو مش عندك.
2. نزّل **GitHub Desktop** من desktop.github.com (أسهل من الأوامر)، وادخل بالأكونت.
3. **الـLMS:**
   - في GitHub Desktop: File ← Add local repository ← اختار `C:\Users\GMP\Documents\lms`.
   - هيقولك إنه مش repo: دوس **create a repository** ← Create repository.
   - دوس **Publish repository**، وسيب علامة **Keep this code private** ← Publish.
4. **الموقع:** نفس الخطوات على `C:\Users\GMP\Documents\brightverse-website`، وبرضه **Private**.
5. افتح الـrepo على github.com واتأكد إن مفيش ملف `.env` ولا ملفات بيانات الموقع اللي في `CLAUDE.md` بتاعه. الـ`.gitignore` المفروض يمنعهم.

## على أي جهاز جديد

1. ثبّت: Node.js 24، وDocker Desktop، وGitHub Desktop (وللموقع: XAMPP أو PHP).
2. GitHub Desktop ← File ← Clone repository ← اختار الـrepo.
3. انقل يدويًا (فلاشة أو واتساب لنفسك) الملفات اللي مش على GitHub:
   - `lms\apps\api\.env`
4. شغّل زي ما في `CLAUDE.md` (قسم Run it).

## كل يوم

| قبل ما تبدأ | لما تخلص |
|---|---|
| GitHub Desktop ← **Fetch origin** ثم **Pull** | اكتب جملة عن اللي اتعمل ← **Commit to main** ← **Push origin** |

- ماتشتغلش على جهازين في نفس الوقت على نفس الملفات. خلّص واعمل Push، وبعدين Pull على التاني.
- لو بعد Pull اتغير حاجة في `apps/api/drizzle`، شغّل `npm run db:migrate` من `apps\api`.
- مع كل Push، GitHub بيشغّل كل التيستات لوحده (تاب **Actions** في صفحة الـrepo). لو فيه ❌ احكيلي.

## أكتر من أكونت Claude

كل أكونت مش شايف محادثات أو ذاكرة التاني. عشان كده كل حاجة مكتوبة جوه المشروع نفسه:

| الملف | فيه إيه |
|---|---|
| `CLAUDE.md` | المشروع، وإزاي يتشغّل ويتختبر، والقرارات اللي اتاخدت. Claude بيقراه لوحده. |
| `docs/ROADMAP.md` | اللي اتعمل، واللي جاي، والقرارات اللي لسه مستنياك. |
| `README.md` | كل الخصائص والقواعد بالتفصيل. |

**أول رسالة لأي أكونت جديد:**

> اقرا CLAUDE.md و docs/ROADMAP.md وكمّل من آخر حاجة. وفي آخر الشغل حدّث الملفين دول.

**آخر رسالة قبل ما تقفل أي جلسة:**

> حدّث ROADMAP.md باللي اتعمل النهارده واللي فاضل.
