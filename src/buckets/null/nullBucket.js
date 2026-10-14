// Placeholder bucket: registered and allocated capital, but always answers
// "no trade". Lets the portfolio shell run unattended before any strategy exists.
import { Bucket } from '../bucket.js';
import { noTrade } from '../intent.js';

export class NullBucket extends Bucket {
  async evaluate() {
    return noTrade('placeholder bucket — strategy not implemented yet');
  }

  status() {
    return { placeholder: true };
  }
}

export default NullBucket;
