import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { FeedbackEntry } from './entities/feedback-entry.entity';

const mockRepo = { create: jest.fn((x) => x), save: jest.fn(async (x) => ({ id: '1', createdAt: new Date(), ...x })), find: jest.fn(), findOne: jest.fn(), count: jest.fn() };
let webhook = '';
const mockCfg = { get: (k: string, d: string) => (k === 'FEEDBACK_WEBHOOK_URL' ? webhook : d) };

describe('FeedbackService', () => {
  let service: FeedbackService;
  const fetchMock = jest.fn(async () => ({ ok: true }));

  beforeEach(async () => {
    jest.clearAllMocks();
    webhook = '';
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: getRepositoryToken(FeedbackEntry), useValue: mockRepo },
        { provide: ConfigService, useValue: mockCfg },
      ],
    }).compile();
    service = module.get(FeedbackService);
  });

  it('stores a trimmed report with the reporter email and context', async () => {
    const e = await service.create('u1', 'a@b.c', {
      kind: 'bug', title: '  Метка не грузится ', message: '  Tron-адрес без тега  ', context: { url: 'https://x/' },
    });
    expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', email: 'a@b.c', kind: 'bug', title: 'Метка не грузится', message: 'Tron-адрес без тега', context: { url: 'https://x/' },
    }));
    expect(e.id).toBe('1');
    expect(fetchMock).not.toHaveBeenCalled(); // no webhook configured
  });

  it('posts to the webhook when one is configured, without failing the request', async () => {
    webhook = 'https://hooks.example/abc';
    await service.create('u1', 'a@b.c', { kind: 'idea', title: 'Экспорт в CSV', message: 'Хочется выгружать таблицу.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe(webhook);
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain('Экспорт в CSV');
    expect(body.text).toContain('a@b.c');
  });

  it('survives a failing webhook', async () => {
    webhook = 'https://hooks.example/abc';
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    await expect(service.create('u1', 'a@b.c', { kind: 'idea', title: 'Заголовок', message: 'Достаточно длинное сообщение' })).resolves.toBeTruthy();
  });

  it('lists newest first, optionally filtered by status', async () => {
    mockRepo.find.mockResolvedValue([]);
    await service.list('new');
    expect(mockRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'new' }, order: { createdAt: 'DESC' } }));
    await service.list();
    expect(mockRepo.find).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });

  it('marks an entry done and 404s on a missing one', async () => {
    mockRepo.findOne.mockResolvedValueOnce({ id: '7', status: 'new' });
    const r = await service.setStatus('7', 'done');
    expect(r.status).toBe('done');
    mockRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.setStatus('missing', 'done')).rejects.toThrow(NotFoundException);
  });
});
