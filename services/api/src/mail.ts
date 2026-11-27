// Письма: приглашение (72 ч, §7.5) и восстановление пароля (V-002). Отправка через почтовую службу Azure —
// в infra/core; здесь интерфейс и две реализации: в память (тесты) и в журнал (локальная разработка).
export interface Mail { to: string; kind: 'invitation' | 'password_reset'; link: string; language: string }

export interface Mailer { send(m: Mail): Promise<void> }

export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  /** Для тестов: почтовая служба недоступна. */
  fail = false;
  async send(m: Mail): Promise<void> {
    if (this.fail) throw new Error('почтовая служба недоступна');
    this.sent.push(m);
  }
}

export class LogMailer implements Mailer {
  async send(m: Mail): Promise<void> {
    // Ссылку не печатаем: в ней токен.
    console.log(`[mail] ${m.kind} → ${m.to.replace(/^(.).*@/, '$1…@')}`);
  }
}
