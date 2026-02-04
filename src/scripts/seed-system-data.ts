import { PrismaClient, CategoryType, PaymentMethodType } from '@prisma/client';

const prisma = new PrismaClient();

async function ensureSystemCategories() {
  const categories = [
    // INCOME
    {
      type: 'INCOME' as CategoryType,
      name: 'Зарплата',
      iconKey: 'salary',
      sortOrder: 10,
      subs: ['Основная зарплата', 'Аванс', 'Премии / бонусы'],
    },
    {
      type: 'INCOME' as CategoryType,
      name: 'Подработка / Фриланс',
      iconKey: 'freelance',
      sortOrder: 20,
      subs: ['Разовые заказы', 'Почасовые задачи', 'Выплаты от клиентов'],
    },
    {
      type: 'INCOME' as CategoryType,
      name: 'Бизнес-доход',
      iconKey: 'biznes',
      sortOrder: 30,
      subs: ['Продажи', 'Услуги', 'Партнёрские комиссии'],
    },
    {
      type: 'INCOME' as CategoryType,
      name: 'Инвестиционные доходы',
      iconKey: 'dohodinvest',
      sortOrder: 40,
      subs: ['Дивиденды', 'Продажа акций/крипты с прибылью', 'Проценты по облигациям', 'Доход от трейдинга'],
    },
    {
      type: 'INCOME' as CategoryType,
      name: 'Пассивный доход',
      iconKey: 'pasifdohod',
      sortOrder: 50,
      subs: ['Кэшбэк', 'Проценты по вкладам', 'Роялти'],
    },
    {
      type: 'INCOME' as CategoryType,
      name: 'Аренда',
      iconKey: 'arenda',
      sortOrder: 60,
      subs: ['Аренда квартиры', 'Аренда авто/оборудования'],
    },
    {
      type: 'INCOME' as CategoryType,
      name: 'Подарки и переводы',
      iconKey: 'hediye',
      sortOrder: 70,
      subs: ['Подаренные деньги', 'Денежная помощь'],
    },
    {
      type: 'INCOME' as CategoryType,
      name: 'Социальные выплаты',
      iconKey: 'soc',
      sortOrder: 80,
      subs: ['Пособия', 'Компенсации', 'Стипендия', 'Пенсия'],
    },
    {
      type: 'INCOME' as CategoryType,
      name: 'Продажа имущества',
      iconKey: 'sale',
      sortOrder: 90,
      subs: ['Продажа техники', 'Продажа одежды', 'Любые личные продажи'],
    },
    {
      type: 'INCOME' as CategoryType,
      name: 'Прочие доходы',
      iconKey: 'procdohod',
      sortOrder: 100,
      subs: [],
    },

    // EXPENSE
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Продукты',
      iconKey: 'produckt',
      sortOrder: 10,
      subs: ['Магазины', 'Рынок', 'Доставка еды'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Кафе и рестораны',
      iconKey: 'cafe-restoraunt',
      sortOrder: 20,
      subs: ['Фастфуд', 'Рестораны', 'Кофейни'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Транспорт',
      iconKey: 'car',
      sortOrder: 30,
      subs: ['Метро / автобус', 'Такси', 'Авто: бензин, обслуживание'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Жильё и коммуналка',
      iconKey: 'komunalka',
      sortOrder: 40,
      subs: ['Аренда', 'Интернет', 'Коммунальные платежи'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Связь и подписки',
      iconKey: 'subb',
      sortOrder: 50,
      subs: ['Мобильная связь', 'RUNA Premium'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Покупки и вещи',
      iconKey: 'pokup',
      sortOrder: 60,
      subs: ['Одежда', 'Обувь', 'Аксессуары', 'Электроника'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Здоровье',
      iconKey: 'healt',
      sortOrder: 70,
      subs: ['Лекарства', 'Врачи', 'Аптеки'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Спорт',
      iconKey: 'sport',
      sortOrder: 80,
      subs: ['Фитнес', 'Спортивное питание', 'Инвентарь'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Образование',
      iconKey: 'book',
      sortOrder: 90,
      subs: ['Курсы', 'Учебники', 'Репетиторы'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Путешествия',
      iconKey: 'airplane',
      sortOrder: 100,
      subs: ['Билеты', 'Отели', 'Туристические услуги'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Подарки',
      iconKey: 'donate',
      sortOrder: 110,
      subs: ['Подарки другим', 'Пожертвования'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Дом и быт',
      iconKey: 'homee',
      sortOrder: 120,
      subs: ['Хозтовары', 'Ремонт', 'Техника для дома'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Развлечения',
      iconKey: 'razvlich',
      sortOrder: 130,
      subs: ['Кино', 'Игры', 'Мероприятия'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Красота и уход',
      iconKey: 'beauty',
      sortOrder: 140,
      subs: ['Парикмахер', 'Косметика', 'Маникюр'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Домашние животные',
      iconKey: 'pets',
      sortOrder: 150,
      subs: ['Корм', 'Ветеринар'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Финансовые обязательства',
      iconKey: 'obligations',
      sortOrder: 160,
      subs: ['Штрафы', 'Комиссии', 'Проценты'],
    },
    {
      type: 'EXPENSE' as CategoryType,
      name: 'Прочие расходы',
      iconKey: 'other_expense',
      sortOrder: 170,
      subs: [],
    },
  ];

  for (const cat of categories) {
    let parent = await prisma.category.findFirst({
      where: { isSystem: true, type: cat.type, name: cat.name },
    });

    if (!parent) {
      parent = await prisma.category.create({
        data: {
          isSystem: true,
          type: cat.type,
          name: cat.name,
          iconKey: cat.iconKey,
          sortOrder: cat.sortOrder,
        },
      });
    } else {
      // Update iconKey if it changed
      await prisma.category.update({
        where: { id: parent.id },
        data: { iconKey: cat.iconKey, sortOrder: cat.sortOrder },
      });
    }

    // Subcategories
    for (const subName of cat.subs) {
      const existingSub = await prisma.category.findFirst({
        where: { isSystem: true, type: cat.type, name: subName, parentId: parent.id },
      });
      if (!existingSub) {
        await prisma.category.create({
          data: {
            isSystem: true,
            type: cat.type,
            name: subName,
            parentId: parent.id,
            sortOrder: 0,
          },
        });
      }
    }
  }
}

async function ensureSystemPaymentMethods() {
  const presets: Array<{ type: PaymentMethodType; name: string; iconKey: string; sortOrder: number }> = [
    { type: 'CASH', name: 'Наличные', iconKey: 'cash', sortOrder: 10 },
    { type: 'DEBIT_CARD', name: 'Дебетовая карта', iconKey: 'debit', sortOrder: 20 },
    { type: 'CREDIT_CARD', name: 'Кредитная карта', iconKey: 'credit', sortOrder: 30 },
  ];

  for (const p of presets) {
    const existing = await prisma.paymentMethod.findFirst({
      where: { isSystem: true, type: p.type, name: p.name },
    });
    if (!existing) {
      await prisma.paymentMethod.create({
        data: {
          isSystem: true,
          type: p.type,
          name: p.name,
          iconKey: p.iconKey,
          sortOrder: p.sortOrder,
        },
      });
    } else {
      await prisma.paymentMethod.update({
        where: { id: existing.id },
        data: { iconKey: p.iconKey, sortOrder: p.sortOrder },
      });
    }
  }
}

async function main() {
  await ensureSystemCategories();
  await ensureSystemPaymentMethods();
}

void main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
