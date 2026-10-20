import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContactsService } from './application/contacts.service';
import { ContactsStore } from './application/ports';
import {
  CONTACT_MODEL,
  ContactSchema,
  TAG_MODEL,
  TagSchema,
} from './infrastructure/contact.schemas';
import { MongoContactsStore } from './infrastructure/mongo-contacts-store';
import {
  ContactsController,
  TagsController,
} from './presentation/contacts.controller';

/** Contacts and tags, stored in MongoDB and always scoped to a workspace. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CONTACT_MODEL, schema: ContactSchema },
      { name: TAG_MODEL, schema: TagSchema },
    ]),
  ],
  controllers: [ContactsController, TagsController],
  providers: [
    ContactsService,
    { provide: ContactsStore, useClass: MongoContactsStore },
  ],
  exports: [ContactsService, ContactsStore],
})
export class ContactsModule {}
