import { getRepository, getCustomRepository, In } from 'typeorm';
import fs from 'fs';
import csvParse from 'csv-parse';

import Category from '../models/Category';
import Transaction from '../models/Transaction';
import TransactionRepository from '../repositories/TransactionsRepository';

interface NewTransaction {
  title: string;
  value: number;
  type: 'income' | 'outcome';
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionRepository = getCustomRepository(TransactionRepository);
    const categoryRepository = getRepository(Category);

    const readStream = fs.createReadStream(filePath);

    const parsers = csvParse({
      from_line: 2, // ignora cabecalho
    });

    // pipe => le as linhas
    const parseCSV = readStream.pipe(parsers);

    const transactions: NewTransaction[] = [];
    const categories: string[] = [];

    // para cada linha retira os espacos em branco e adiciona nos arrays
    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value) return;

      categories.push(category);

      transactions.push({ title, type, value, category });
    });

    // parseCSV.on eh sincrono, por isso precisamos utilizar uma promise
    await new Promise(resolve => parseCSV.on('end', resolve));

    // pega todas as categories do banco que estao no array
    const existentCategories = await categoryRepository.find({
      where: { title: In(categories) },
    });

    // pega title das categories que existem no banco
    const existentCategoriesTitles = existentCategories.map(
      (category: Category) => category.title,
    );

    const addCategoryTitle = categories
      .filter(category => !existentCategoriesTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    const newCategories = categoryRepository.create(
      addCategoryTitle.map(title => ({
        title,
      })),
    );

    await categoryRepository.save(newCategories);

    const finalCategories = [...newCategories, ...existentCategories];

    const createdTransactions = transactionRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: finalCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    await transactionRepository.save(createdTransactions);

    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
